import AppTabs from '@/components/navigation/app-tabs';
import { useGlanceSync } from '@/lib/glance';
import { useCravingActivitySync } from '@/lib/live-activity';
import { useOutboxSync } from '@/lib/outbox';

export default function TabsLayout() {
  useGlanceSync();
  useOutboxSync();
  useCravingActivitySync();
  return <AppTabs />;
}
