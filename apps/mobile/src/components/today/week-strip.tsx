import { addDays, startOfWeek } from '@symbiose/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { View } from 'react-native';

import { Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { dayOfMonth, weekdayInitial } from '@/lib/format';
import { Radius, useTheme } from '@/theme';

/** Monday→Sunday strip. Days after today are disabled. */
export function WeekStrip({ selected, today, onSelect }: { selected: string; today: string; onSelect: (date: string) => void }) {
  const { locale } = useI18n();
  const { colors } = useTheme();
  const monday = startOfWeek(selected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const canGoForward = addDays(monday, 7) <= today;

  return (
    <Row gap={2} style={{ justifyContent: 'space-between' }}>
      <Pressy onPress={() => onSelect(addDays(selected, -7))} hitSlop={8} accessibilityLabel="previous week" style={{ padding: 4 }}>
        <ChevronLeft size={18} color={colors.text3} />
      </Pressy>
      {days.map((day) => {
        const isSelected = day === selected;
        const isToday = day === today;
        const future = day > today;
        return (
          <Pressy
            key={day}
            disabled={future}
            onPress={() => onSelect(day)}
            style={{
              width: 40,
              height: 58,
              borderRadius: Radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              backgroundColor: isSelected ? colors.inverted : 'transparent',
            }}>
            <Txt variant="caption" style={{ fontSize: 11, fontWeight: '600' }} color={isSelected ? colors.onInverted : colors.text3}>
              {weekdayInitial(day, locale)}
            </Txt>
            <Txt variant="label" style={{ fontSize: 16, fontWeight: '700' }} color={isSelected ? colors.onInverted : colors.text}>
              {dayOfMonth(day)}
            </Txt>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isToday && !isSelected ? colors.accent : 'transparent' }} />
          </Pressy>
        );
      })}
      <Pressy onPress={() => onSelect(addDays(selected, 7) > today ? today : addDays(selected, 7))} disabled={!canGoForward && selected === today} hitSlop={8} accessibilityLabel="next week" style={{ padding: 4 }}>
        <ChevronRight size={18} color={colors.text3} />
      </Pressy>
    </Row>
  );
}
