lines = open('api/app/services/scheduler.py', 'r').readlines()
out = []
for i, line in enumerate(lines, 1):
    out.append(line)
    if i == 140 and 'now_local' in line:
        out.append('        print(f"[SCHEDULER TICK] {now_local.isoformat()}")\n')
    if i == 146 and '.all()' in line:
        out.append('        print(f"[SCHEDULER] Found {len(schedules)} active schedule(s)")\n')
    if i == 80 and 'today.day == schedule.trigger_value' in line:
        out[-1] = '        result = today.day == schedule.trigger_value\n'
        out.append('        print(f"[SCHEDULER] _should_fire: day={today.day}==trigger={schedule.trigger_value}? {result}, time={current_hhmm}>={schedule.time_of_day}? {current_hhmm >= schedule.time_of_day}, last_run={schedule.last_run_at}")\n')
        out.append('        return result\n')
    if i == 187 and 'except Exception' in line:
        out[-1] = '            except Exception as e:\n'
        out.append('                print(f"[SCHEDULER ERROR] schedule={schedule.id}: {e}")\n')
    if i == 207 and 'logger.info' in line:
        out.append('    print("[SCHEDULER] Notification scheduler started (interval: 15 minutes)")\n')
open('api/app/services/scheduler.py', 'w').writelines(out)
print('Done')
