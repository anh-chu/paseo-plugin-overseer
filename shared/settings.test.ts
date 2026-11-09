import {expect, it} from 'vitest';
import {preferences, watchesProject} from './contracts';

it('starts without watching any project', () => {
  const settings = preferences.schema.parse({});
  expect(settings.projectNames).toEqual([]);
  expect(settings.projectIds).toEqual([]);
  expect(watchesProject(settings, 'project', 'Any project')).toBe(false);
});
it('keeps old saved selections and defaults compatible', () => {
  const settings = preferences.schema.parse({projectNames: ['Existing project'], autoName: true});
  expect(watchesProject(settings, 'project', 'existing PROJECT')).toBe(true);
  expect(settings.codexModel).toBe('gpt-6-luna');
  expect(settings.autoName).toBe(true);
});
it('keeps watching the selected project after its name changes', () => {
  const settings = preferences.schema.parse({projectIds: ['stable-project']});
  expect(watchesProject(settings, 'stable-project', 'Renamed project')).toBe(true);
  expect(watchesProject(settings, 'different-project', 'Renamed project')).toBe(false);
});
it('validates a user selected Codex model', () => {
  expect(preferences.schema.parse({codexModel: '  another-model  '}).codexModel).toBe('another-model');
  expect(preferences.schema.safeParse({codexModel: '--bad model'}).success).toBe(false);
});

it('accepts qualified models from any provider without restricting native IDs', () => {
  expect(preferences.schema.parse({providerModel: 'custom/vendor/model[1m]'}).providerModel).toBe('custom/vendor/model[1m]');
  expect(preferences.schema.parse({codexModel: 'gpt-6-luna'}).providerModel).toBeNull();
  expect(preferences.schema.safeParse({providerModel: 'model-only'}).success).toBe(false);
});
