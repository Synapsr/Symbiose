import { useEffect } from 'react';

import AppTabs from '@/components/navigation/app-tabs';
import { feedback } from '@/lib/feedback';
import { useGlanceSync } from '@/lib/glance';
import { useCravingActivitySync } from '@/lib/live-activity';
import { useOutboxSync } from '@/lib/outbox';
import { useProactiveSync } from '@/lib/proactive';

export default function TabsLayout() {
  // The reward sounds load once, ahead of the first one.
  useEffect(() => feedback.prepare(), []);
  useGlanceSync();
  useOutboxSync();
  useCravingActivitySync();
  useProactiveSync();
  return <AppTabs />;
}
