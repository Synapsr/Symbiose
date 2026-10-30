import AppTabs from '@/components/navigation/app-tabs';
import { useGlanceSync } from '@/lib/glance';
import { useCravingActivitySync } from '@/lib/live-activity';

export default function TabsLayout() {
  useGlanceSync();
  useCravingActivitySync();
  return <AppTabs />;
}
