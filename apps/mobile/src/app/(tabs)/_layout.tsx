import AppTabs from '@/components/navigation/app-tabs';
import { useGlanceSync } from '@/lib/glance';
import { useOutboxSync } from '@/lib/outbox';

export default function TabsLayout() {
  useGlanceSync();
  useOutboxSync();
  return <AppTabs />;
}
