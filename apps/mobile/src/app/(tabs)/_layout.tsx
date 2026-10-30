import AppTabs from '@/components/navigation/app-tabs';
import { useGlanceSync } from '@/lib/glance';

export default function TabsLayout() {
  useGlanceSync();
  return <AppTabs />;
}
