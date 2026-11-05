alter table public.cm_demonstrations
  add column if not exists archived_at timestamptz,
  alter column first_scheduled_date drop not null,
  alter column current_scheduled_date drop not null;
alter table public.cm_reschedule_logs alter column previous_date drop not null;

-- Clear only untouched schedules created by a webhook without a meeting date.
update public.cm_demonstrations d
set first_scheduled_date = null, current_scheduled_date = null
where d.crm_deal_id is not null and d.status = 'agendado'
  and not d.is_completed and d.reschedule_count = 0
  and d.updated_at = d.created_at
  and d.first_scheduled_date = d.current_scheduled_date
  and exists (
    select 1 from public.cm_webhook_logs l
    where l.response->>'demoId' = d.id::text
      and l.event = 'demo_scheduled' and l.response->>'action' = 'created'
      and nullif(l.payload->'data'->>'scheduled_at', '') is null
      and nullif(l.payload->'data'->>'current_scheduled_date', '') is null
      and nullif(l.payload->>'scheduled_at', '') is null
      and nullif(l.payload->>'current_scheduled_date', '') is null
  );
