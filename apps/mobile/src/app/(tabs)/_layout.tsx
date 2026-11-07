import { useEffect } from 'react';

import AppTabs from '@/components/navigation/app-tabs';
import { feedback } from '@/lib/feedback';
import { useGlanceSync } from '@/lib/glance';
import { useCravingActivitySync } from '@/lib/live-activity';
import { useOutboxSync } from '@/lib/outbox';
import { useProactiveSync } from '@/lib/proactive';
import { useCelebrations, useStreakReminderSync } from '@/lib/progress';
import { useServerAiNotice } from '@/lib/server-ai-notice';
import { useWatchRequests } from '@/lib/watch';

export default function TabsLayout() {
  // The reward sounds load once, ahead of the first one.
  useEffect(() => feedback.prepare(), []);
  useGlanceSync();
  useOutboxSync();
  useCravingActivitySync();
  useProactiveSync();
  useWatchRequests();
  useServerAiNotice();
  // « Séries et étapes »: the flame and the milestones are celebrated here, and the evening reminder kept in step.
  useCelebrations();
  useStreakReminderSync();
  return <AppTabs />;
}
