import { ExtensionStorage } from '@bacons/apple-targets';

import type { GlanceContext } from '@/lib/glance';

/**
 * The App Group shared with the widget extension. Key names mirror
 * targets/controls/_shared/SymbioseGroup.swift: keep them in sync.
 */
const appGroup = new ExtensionStorage('group.io.synapsr.symbiose');

const TODAY_WIDGET = 'io.synapsr.symbiose.widget.today';
const KEYS = ['widget.glance', 'widget.syncedAt', 'widget.serverUrl', 'widget.token', 'widget.locale', 'widget.hideCalories', 'craving.pendingOutcomes', 'craving.changed'];

let lastSynced: string | null = null;

/**
 * Hands Today to the Home and Lock Screen widgets, with what they need to
 * refresh it on their own later (server, token). Signed out, it clears all of it.
 */
export function syncWidgets(context: GlanceContext | null) {
  if (!context) {
    if (lastSynced === '') return;
    lastSynced = '';
    for (const key of KEYS) appGroup.remove(key);
    ExtensionStorage.reloadWidget(TODAY_WIDGET);
    return;
  }

  const glance = JSON.stringify(context.glance);
  const signature = [glance, context.serverUrl, context.token, context.locale, context.hideCalories].join('\n');
  if (signature === lastSynced) return;
  lastSynced = signature;

  appGroup.set('widget.glance', glance);
  appGroup.set('widget.syncedAt', Date.now());
  appGroup.set('widget.serverUrl', context.serverUrl);
  appGroup.set('widget.token', context.token);
  appGroup.set('widget.locale', context.locale);
  appGroup.set('widget.hideCalories', context.hideCalories ? 1 : 0);
  ExtensionStorage.reloadWidget(TODAY_WIDGET);
}
