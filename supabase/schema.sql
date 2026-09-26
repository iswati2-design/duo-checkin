-- ============================================================================
--  语伴打卡 · Supabase 数据库初始化脚本
--  在 Supabase 控制台 → SQL Editor 里整段执行即可(可重复执行,幂等)
-- ============================================================================
--  表结构
--    rooms       房间(6 位邀请码)
--    members     房间成员(匿名登录的 auth.users.id,每房间最多 2 人)
--    tasks       每个成员自己的每日学习任务
--    daily_logs  每人每天的打卡记录(时长/备注/完成度)
--    log_tasks   打卡记录里每个任务的完成明细
--    reactions   互动:点赞 / 催打卡 / 加油
--
--  安全模型
--    · 客户端用 Supabase 匿名登录(Anonymous Sign-In),无需邮箱密码
--    · 建房 / 加入房间走 SECURITY DEFINER 的 RPC,服务端校验邀请码与人数上限
--    · 其余读写全部走 RLS:只能看到/修改自己所在房间的数据
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 扩展
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. 表
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null default '我们的语言学习房间',
  created_at  timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-Z0-9]{6}$')
);

create table if not exists public.members (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  user_id       uuid not null,
  nickname      text not null,
  emoji         text not null default '🐣',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  title         text not null,
  emoji         text not null default '📌',
  target_value  numeric not null default 1,
  target_unit   text not null default '次',
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.daily_logs (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  log_date      date not null,
  duration_min  int not null default 0 check (duration_min >= 0 and duration_min <= 1440),
  note          text not null default '',
  total_tasks   int not null default 0,
  done_tasks    int not null default 0,
  completion    int not null default 0 check (completion >= 0 and completion <= 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (member_id, log_date)
);

create table if not exists public.log_tasks (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  log_id     uuid not null references public.daily_logs(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  is_done    boolean not null default false,
  amount     numeric not null default 0,
  unique (log_id, task_id)
);

-- 兼容已存在的旧表(缺列时补上),保证脚本可重复执行
alter table public.log_tasks add column if not exists room_id uuid references public.rooms(id) on delete cascade;

create table if not exists public.reactions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  from_member  uuid not null references public.members(id) on delete cascade,
  to_member    uuid not null references public.members(id) on delete cascade,
  log_date     date not null default current_date,
  kind         text not null check (kind in ('like', 'nudge', 'cheer')),
  message      text not null default '',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. 索引
-- ---------------------------------------------------------------------------
create index if not exists members_room_idx        on public.members (room_id);
create index if not exists members_user_idx        on public.members (user_id);
create index if not exists tasks_room_member_idx   on public.tasks (room_id, member_id);
create index if not exists logs_room_date_idx      on public.daily_logs (room_id, log_date);
create index if not exists logs_member_date_idx    on public.daily_logs (member_id, log_date);
create index if not exists log_tasks_log_idx       on public.log_tasks (log_id);
create index if not exists log_tasks_room_idx      on public.log_tasks (room_id);
create index if not exists reactions_room_date_idx on public.reactions (room_id, log_date);

-- ---------------------------------------------------------------------------
-- 3. 辅助函数(SECURITY DEFINER:绕过 RLS 做归属判断,避免策略递归)
-- ---------------------------------------------------------------------------
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.members m
    where m.room_id = p_room and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.my_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id from public.members m where m.user_id = (select auth.uid());
$$;

create or replace function public.is_log_in_my_room(p_log uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.daily_logs l
    join public.members m on m.room_id = l.room_id
    where l.id = p_log and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_my_log(p_log uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.daily_logs l
    where l.id = p_log and l.member_id in (select public.my_member_ids())
  );
$$;

-- 生成 6 位易读邀请码(去掉 0/O/1/I 等易混字符)
create or replace function public.gen_room_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- 新成员默认任务(背单词 / 听力 / 口语 / 阅读 / 写作)
create or replace function public.seed_default_tasks(p_room uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tasks (room_id, member_id, title, emoji, target_value, target_unit, sort_order)
  values
    (p_room, p_member, '背单词',   '📚', 50, '个',   0),
    (p_room, p_member, '听力',     '🎧', 20, '分钟', 1),
    (p_room, p_member, '口语跟读', '🗣️', 10, '分钟', 2),
    (p_room, p_member, '阅读',     '📖', 1,  '篇',   3),
    (p_room, p_member, '写作',     '✍️', 1,  '篇',   4);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC:建房 / 加入房间
-- ---------------------------------------------------------------------------
create or replace function public.create_room(p_nickname text, p_emoji text default '🐣')
returns table (room_id uuid, code text, member_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_code   text;
  v_room   uuid;
  v_member uuid;
  v_try    int := 0;
  v_nick   text := nullif(trim(coalesce(p_nickname, '')), '');
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if v_nick is null then
    raise exception 'NICKNAME_REQUIRED' using errcode = 'P0001';
  end if;

  loop
    v_try := v_try + 1;
    v_code := public.gen_room_code();
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
    if v_try > 50 then
      raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.rooms (code) values (v_code) returning id into v_room;

  insert into public.members (room_id, user_id, nickname, emoji)
  values (v_room, v_uid, left(v_nick, 20), coalesce(nullif(trim(coalesce(p_emoji, '')), ''), '🐣'))
  returning id into v_member;

  perform public.seed_default_tasks(v_room, v_member);

  return query select v_room, v_code, v_member;
end;
$$;

create or replace function public.join_room(p_code text, p_nickname text, p_emoji text default '🐣')
returns table (room_id uuid, code text, member_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_room     uuid;
  v_member   uuid;
  v_count    int;
  v_nick     text := nullif(trim(coalesce(p_nickname, '')), '');
  v_emoji    text := coalesce(nullif(trim(coalesce(p_emoji, '')), ''), '🐣');
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if v_nick is null then
    raise exception 'NICKNAME_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_code) <> 6 then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select r.id into v_room from public.rooms r where r.code = v_code;
  if v_room is null then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 已是成员 → 更新昵称/头像并返回(支持重装/换机后重新进入)
  select m.id into v_member from public.members m where m.room_id = v_room and m.user_id = v_uid;
  if v_member is not null then
    update public.members
       set nickname = left(v_nick, 20), emoji = v_emoji, last_seen_at = now()
     where id = v_member;
    return query select v_room, v_code, v_member;
    return;
  end if;

  -- 房间人数上限:2 人
  select count(*) into v_count from public.members m where m.room_id = v_room;
  if v_count >= 2 then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  insert into public.members (room_id, user_id, nickname, emoji)
  values (v_room, v_uid, left(v_nick, 20), v_emoji)
  returning id into v_member;

  perform public.seed_default_tasks(v_room, v_member);

  return query select v_room, v_code, v_member;
end;
$$;

grant execute on function public.create_room(text, text)      to anon, authenticated;
grant execute on function public.join_room(text, text, text)   to anon, authenticated;
-- 策略里用到的辅助函数同样必须授权,否则 RLS 评估会报 permission denied
grant execute on function public.is_room_member(uuid)          to anon, authenticated;
grant execute on function public.my_member_ids()               to anon, authenticated;
grant execute on function public.is_log_in_my_room(uuid)       to anon, authenticated;
grant execute on function public.is_my_log(uuid)               to anon, authenticated;
grant execute on function public.gen_room_code()               to anon, authenticated;
grant execute on function public.seed_default_tasks(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. updated_at 触发器
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists daily_logs_touch on public.daily_logs;
create trigger daily_logs_touch
  before update on public.daily_logs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS 策略
-- ---------------------------------------------------------------------------
alter table public.rooms      enable row level security;
alter table public.members    enable row level security;
alter table public.tasks      enable row level security;
alter table public.daily_logs enable row level security;
alter table public.log_tasks  enable row level security;
alter table public.reactions  enable row level security;

-- rooms:本房间成员可读可改名(创建走 RPC)
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to anon, authenticated
  using (public.is_room_member(id));

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms
  for update to anon, authenticated
  using (public.is_room_member(id))
  with check (public.is_room_member(id));

-- members:同房间成员互相可见;只能改/删自己那一行
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to anon, authenticated
  using (public.is_room_member(room_id));

drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members
  for update to anon, authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists members_delete_self on public.members;
create policy members_delete_self on public.members
  for delete to anon, authenticated
  using (user_id = (select auth.uid()));

drop policy if exists members_insert_self on public.members;
create policy members_insert_self on public.members
  for insert to anon, authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));

-- tasks:房间内可见;只有本人能增删改自己的任务
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to anon, authenticated
  using (public.is_room_member(room_id));

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks
  for insert to anon, authenticated
  with check (member_id in (select public.my_member_ids()) and public.is_room_member(room_id));

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks
  for update to anon, authenticated
  using (member_id in (select public.my_member_ids()))
  with check (member_id in (select public.my_member_ids()));

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks
  for delete to anon, authenticated
  using (member_id in (select public.my_member_ids()));

-- daily_logs:房间内可读;只能写自己的打卡
drop policy if exists logs_select on public.daily_logs;
create policy logs_select on public.daily_logs
  for select to anon, authenticated
  using (public.is_room_member(room_id));

drop policy if exists logs_insert_own on public.daily_logs;
create policy logs_insert_own on public.daily_logs
  for insert to anon, authenticated
  with check (member_id in (select public.my_member_ids()) and public.is_room_member(room_id));

drop policy if exists logs_update_own on public.daily_logs;
create policy logs_update_own on public.daily_logs
  for update to anon, authenticated
  using (member_id in (select public.my_member_ids()))
  with check (member_id in (select public.my_member_ids()));

drop policy if exists logs_delete_own on public.daily_logs;
create policy logs_delete_own on public.daily_logs
  for delete to anon, authenticated
  using (member_id in (select public.my_member_ids()));

-- log_tasks:随所属打卡记录判定权限
drop policy if exists log_tasks_select on public.log_tasks;
create policy log_tasks_select on public.log_tasks
  for select to anon, authenticated
  using (public.is_log_in_my_room(log_id));

drop policy if exists log_tasks_write_own on public.log_tasks;
create policy log_tasks_write_own on public.log_tasks
  for insert to anon, authenticated
  with check (public.is_my_log(log_id));

drop policy if exists log_tasks_update_own on public.log_tasks;
create policy log_tasks_update_own on public.log_tasks
  for update to anon, authenticated
  using (public.is_my_log(log_id))
  with check (public.is_my_log(log_id));

drop policy if exists log_tasks_delete_own on public.log_tasks;
create policy log_tasks_delete_own on public.log_tasks
  for delete to anon, authenticated
  using (public.is_my_log(log_id));

-- reactions:房间内可读;只能以自己身份发出
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select to anon, authenticated
  using (public.is_room_member(room_id));

drop policy if exists reactions_insert_own on public.reactions;
create policy reactions_insert_own on public.reactions
  for insert to anon, authenticated
  with check (
    from_member in (select public.my_member_ids())
    and public.is_room_member(room_id)
  );

drop policy if exists reactions_delete_own on public.reactions;
create policy reactions_delete_own on public.reactions
  for delete to anon, authenticated
  using (from_member in (select public.my_member_ids()));

-- ---------------------------------------------------------------------------
-- 7. 表级授权
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.rooms, public.members, public.tasks,
      public.daily_logs, public.log_tasks, public.reactions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Realtime(实时同步)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['rooms', 'members', 'tasks', 'daily_logs', 'log_tasks', 'reactions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- DELETE 事件的 filter 需要完整旧行,才能按 room_id 过滤
alter table public.rooms      replica identity full;
alter table public.members    replica identity full;
alter table public.tasks      replica identity full;
alter table public.daily_logs replica identity full;
alter table public.log_tasks  replica identity full;
alter table public.reactions  replica identity full;

-- ---------------------------------------------------------------------------
-- 9. 自检(执行后应返回 6 张表、6 条策略组、若干函数)
-- ---------------------------------------------------------------------------
-- select tablename from pg_tables where schemaname = 'public' order by tablename;
-- select tablename, policyname from pg_policies where schemaname = 'public' order by tablename;
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';

-- ============================================================================
--  完成 ✅  接下来只需在 Authentication → Sign In / Providers 打开
--  "Anonymous sign-ins",然后把 Project URL 与 anon key 填入应用即可。
-- ============================================================================
