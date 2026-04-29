import { useState, useMemo, useCallback } from 'react';
import { Clock, Send, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ScheduleMode = 'now' | 'scheduled';

export interface ScheduleValue {
  mode: ScheduleMode;
  scheduledDate?: Date;
}

interface SchedulePickerProps {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  /** Label context for summary, e.g. "emails" or "calls" */
  itemLabel?: string;
  itemCount?: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date) {
  return isSameDay(d, new Date());
}

function isPast(d: Date) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return d < now;
}

export function SchedulePicker({ value, onChange, itemLabel = 'emails', itemCount = 0 }: SchedulePickerProps) {
  const { t, i18n } = useTranslation();
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(value.scheduledDate?.getMonth() ?? now.getMonth());
  const [viewYear, setViewYear] = useState(value.scheduledDate?.getFullYear() ?? now.getFullYear());

  // Selected date/time from value or defaults
  const selectedDate = value.scheduledDate ?? (() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  })();

  const selectedHour = selectedDate.getHours();
  const selectedMinute = selectedDate.getMinutes();

  // Calendar grid — only generate the rows we need (not always 6)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: { date: Date; inMonth: boolean }[] = [];

    // Previous month trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({
        date: new Date(viewYear, viewMonth - 1, daysInPrevMonth - i),
        inMonth: false,
      });
    }

    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(viewYear, viewMonth, i),
        inMonth: true,
      });
    }

    // Fill to complete the last row (nearest multiple of 7)
    const remainder = days.length % 7;
    if (remainder > 0) {
      const fill = 7 - remainder;
      for (let i = 1; i <= fill; i++) {
        days.push({
          date: new Date(viewYear, viewMonth + 1, i),
          inMonth: false,
        });
      }
    }

    return days;
  }, [viewMonth, viewYear]);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  }, [viewMonth]);

  const selectDate = useCallback((date: Date) => {
    const newDate = new Date(date);
    newDate.setHours(selectedHour, selectedMinute, 0, 0);
    onChange({ mode: 'scheduled', scheduledDate: newDate });
  }, [onChange, selectedHour, selectedMinute]);

  const setTime = useCallback((hour: number, minute: number) => {
    const newDate = new Date(selectedDate);
    newDate.setHours(hour, minute, 0, 0);
    onChange({ mode: 'scheduled', scheduledDate: newDate });
  }, [onChange, selectedDate]);

  const formatScheduledTime = () => {
    if (!value.scheduledDate) return '';
    const d = value.scheduledDate;
    const lang = i18n.language || 'en';
    const h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const dayName = d.toLocaleDateString(lang, { weekday: 'short' });
    const monthName = d.toLocaleDateString(lang, { month: 'short' });
    return `${dayName}, ${monthName} ${d.getDate()} at ${h12}:${pad(d.getMinutes())} ${ampm}`;
  };

  // Check if we can go to previous month (don't allow past months)
  const canGoPrev = viewYear > now.getFullYear() || (viewYear === now.getFullYear() && viewMonth > now.getMonth());

  // Generate time options
  const hours12 = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = [0, 15, 30, 45];
  const currentAmPm = selectedHour >= 12 ? 'PM' : 'AM';
  const currentHour12 = selectedHour === 0 ? 12 : selectedHour > 12 ? selectedHour - 12 : selectedHour;

  // Locale-aware month and day names
  const localizedMonths = useMemo(() => {
    const lang = i18n.language || 'en';
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2026, i, 1);
      return d.toLocaleDateString(lang, { month: 'long' });
    });
  }, [i18n.language]);

  const localizedDaysShort = useMemo(() => {
    const lang = i18n.language || 'en';
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2026, 0, 4 + i); // Jan 4 2026 is a Sunday
      return d.toLocaleDateString(lang, { weekday: 'short' }).slice(0, 2).toUpperCase();
    });
  }, [i18n.language]);

  return (
    <div className="space-y-3">
      {/* Mode Selector */}
      <div className="flex gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={() => onChange({ mode: 'now' })}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[13px] font-semibold transition-all ${
            value.mode === 'now'
              ? 'bg-white dark:bg-white/[0.08] text-zinc-900 dark:text-white shadow-sm border border-zinc-200/80 dark:border-white/[0.08]'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          {t('campaignBuilder.scheduleSendNow')}
        </button>
        <button
          type="button"
          onClick={() => {
            const defaultDate = new Date();
            defaultDate.setHours(defaultDate.getHours() + 1, 0, 0, 0);
            onChange({ mode: 'scheduled', scheduledDate: value.scheduledDate ?? defaultDate });
          }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[13px] font-semibold transition-all ${
            value.mode === 'scheduled'
              ? 'bg-white dark:bg-white/[0.08] text-zinc-900 dark:text-white shadow-sm border border-zinc-200/80 dark:border-white/[0.08]'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          {t('campaignBuilder.scheduleSchedule')}
        </button>
      </div>

      {/* Send Now Description */}
      {value.mode === 'now' && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-50/80 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/[0.06]">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
            <Send className="w-3.5 h-3.5 text-white dark:text-zinc-900" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-zinc-900 dark:text-white">
              {itemCount > 0 ? t('campaignBuilder.scheduleWillBeSent', { count: itemCount, label: itemLabel }) : t('campaignBuilder.scheduleAllWillBeSent', { label: itemLabel })}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t('campaignBuilder.scheduleProcessingBegins')}
            </p>
          </div>
        </div>
      )}

      {/* Schedule Picker — compact on desktop */}
      {value.mode === 'scheduled' && (
        <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
          {/* Inner wrapper constrains calendar width on desktop */}
          <div className="max-w-[340px] mx-auto">
            {/* Calendar Header */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <button
                type="button"
                onClick={prevMonth}
                disabled={!canGoPrev}
                className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </button>
              <span className="text-[13px] font-semibold text-zinc-900 dark:text-white tracking-tight">
                {localizedMonths[viewMonth]} {viewYear}
              </span>
              <button
                type="button"
                onClick={nextMonth}
                className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 px-3">
              {localizedDaysShort.map((d, i) => (
                <div key={i} className="text-center text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar Grid — fixed-height cells instead of aspect-square */}
            <div className="grid grid-cols-7 px-3 pb-2">
              {calendarDays.map(({ date, inMonth }, idx) => {
                const selected = isSameDay(date, selectedDate);
                const today = isToday(date);
                const past = isPast(date);
                const disabled = !inMonth || past;

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectDate(date)}
                    className={`relative h-9 flex items-center justify-center text-[12px] rounded-lg transition-all ${
                      selected
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold shadow-sm'
                        : disabled
                          ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'
                          : today
                            ? 'text-zinc-900 dark:text-white font-semibold hover:bg-zinc-100 dark:hover:bg-white/[0.08]'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {date.getDate()}
                    {today && !selected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-zinc-900 dark:bg-white" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Picker — full width */}
          <div className="px-4 py-3 border-t border-zinc-100 dark:border-white/[0.04]">
            <div className="max-w-[340px] mx-auto">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  {t('campaignBuilder.scheduleTime')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Hour */}
                <select
                  value={currentHour12}
                  onChange={(e) => {
                    const h12 = parseInt(e.target.value);
                    let h24 = currentAmPm === 'AM' ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);
                    setTime(h24, selectedMinute);
                  }}
                  className="flex-1 px-2 py-2 text-[13px] font-medium border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03] text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors text-center"
                >
                  {hours12.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>

                <span className="text-zinc-400 dark:text-zinc-500 font-bold text-[13px]">:</span>

                {/* Minute */}
                <select
                  value={selectedMinute}
                  onChange={(e) => setTime(selectedHour, parseInt(e.target.value))}
                  className="flex-1 px-2 py-2 text-[13px] font-medium border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03] text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors text-center"
                >
                  {minutes.map(m => (
                    <option key={m} value={m}>{pad(m)}</option>
                  ))}
                </select>

                {/* AM/PM */}
                <div className="flex rounded-lg border border-zinc-200 dark:border-white/[0.08] overflow-hidden">
                  {(['AM', 'PM'] as const).map(period => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => {
                        let h24: number;
                        if (period === 'AM') {
                          h24 = currentHour12 === 12 ? 0 : currentHour12;
                        } else {
                          h24 = currentHour12 === 12 ? 12 : currentHour12 + 12;
                        }
                        setTime(h24, selectedMinute);
                      }}
                      className={`px-3 py-2 text-[12px] font-semibold transition-colors ${
                        currentAmPm === period
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                          : 'bg-zinc-50 dark:bg-white/[0.03] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Scheduled Summary */}
          {value.scheduledDate && (
            <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-white/[0.04] bg-zinc-50/60 dark:bg-white/[0.01]">
              <div className="flex items-center gap-2.5 justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-white animate-pulse" />
                <p className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                  {t('campaignBuilder.scheduleScheduledFor')} <span className="text-zinc-900 dark:text-white font-semibold">{formatScheduledTime()}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}