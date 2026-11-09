import type {PluginHandlerContext} from "@getpaseo/plugin/server";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {helperOptions, managedHelper, providerExecutor, reportedUsage, splitSelection} from "./provider";

type Api = PluginHandlerContext["paseo"];
const directories: string[] = [];
afterEach(async () => {vi.useRealTimers(); for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});});
const usage = {inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, totalCostUsd: 0.002};
async function fixture() {
  const directory = await mkdtemp("/tmp/overseer-provider-test-"); directories.push(directory);
  const helper = {id: "helper", workspaceId: "workspace", lastUsage: usage, archive: vi.fn().mockResolvedValue({}), waitForFinish: vi.fn().mockResolvedValue({status: "idle", lastMessage: '{"purpose":"Review"}', final: {lastUsage: usage}})};
  const create = vi.fn().mockResolvedValue(helper);
  const api = {agents: {create}, workspaces: {archive: vi.fn().mockResolvedValue({})}, providers: {waitForReady: vi.fn().mockResolvedValue({entries: [{provider: "custom", enabled: true, status: "ready"}]}), listModels: vi.fn().mockResolvedValue({models: [{id: "vendor/model[1m]"}]})}};
  return {directory, api, helper, create, execute: providerExecutor(api as unknown as Api, join(directory, "helper"), create)};
}
it('splits only the provider prefix and keeps native model IDs', () => {
  expect(splitSelection('custom/vendor/model[1m]')).toEqual({provider: 'custom', model: 'vendor/model[1m]'});
  expect(() => splitSelection('invalid')).toThrow('Choose');
});
it('does not invent omitted usage, reasoning, or account costs', () => {
  expect(reportedUsage({inputTokens: 0, outputTokens: 0})).toEqual({tokens: {inputTokens: 0, outputTokens: 0, cachedInputTokens: null, reasoningTokens: null}, costUsd: null});
  expect(reportedUsage(undefined)).toEqual({tokens: null, costUsd: null});
  expect(reportedUsage({inputTokens: 1})).toEqual({tokens: null, costUsd: null});
  expect(reportedUsage({inputTokens: 1, outputTokens: 1, cachedInputTokens: 2, totalCostUsd: -1})).toEqual({tokens: null, costUsd: null});
});
it('creates one isolated helper and archives it', async () => {
  const {api, helper, create, execute} = await fixture();
  const result = await execute('custom/vendor/model[1m]', 'activity', 'instructions', {type: 'object'}, new AbortController().signal);
  expect(result).toMatchObject({text: '{"purpose":"Review"}', costUsd: 0.002, tokens: {inputTokens: 100, outputTokens: 20, reasoningTokens: null}});
  expect(create.mock.calls[0][0]).toMatchObject({selection: 'custom/vendor/model[1m]', instructions: 'instructions'});
  expect(create.mock.calls[0][0].cwd).toContain('/helper/review-');
  expect(helper.archive).toHaveBeenCalledOnce(); expect(api.workspaces.archive).not.toHaveBeenCalled();
});
it('refuses disabled providers and unavailable models before creation', async () => {
  const {api, create, execute} = await fixture();
  api.providers.waitForReady.mockResolvedValueOnce({entries: [{provider: 'custom', enabled: false, status: 'ready'}]});
  await expect(execute('custom/vendor/model[1m]', '', '', {}, new AbortController().signal)).rejects.toThrow('not enabled');
  api.providers.listModels.mockResolvedValueOnce({models: []});
  await expect(execute('custom/vendor/model[1m]', '', '', {}, new AbortController().signal)).rejects.toThrow('unavailable');
  expect(create).not.toHaveBeenCalled();
});
it('preserves usage when permission requests reject a review and cleans up', async () => {
  const {helper, execute} = await fixture();
  helper.waitForFinish.mockResolvedValueOnce({status: 'permission', lastMessage: null, final: {lastUsage: usage}});
  let error: any;
  try {await execute('custom/vendor/model[1m]', '', '', {}, new AbortController().signal);} catch (caught) {error = caught;}
  expect(error.message).toContain('permission'); expect(error.result.costUsd).toBe(0.002);
  expect(helper.archive).toHaveBeenCalledOnce();
});
it('archives a helper that finishes creation after cancellation', async () => {
  const {helper, create, execute} = await fixture();
  let finish!: (value: typeof helper) => void;
  create.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const controller = new AbortController();
  const pending = execute('custom/vendor/model[1m]', '', '', {}, controller.signal);
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  controller.abort();
  await expect(pending).rejects.toThrow('canceled');
  finish(helper);
  await vi.waitFor(() => expect(helper.archive).toHaveBeenCalledOnce());
  expect(helper.waitForFinish).not.toHaveBeenCalled();
});
it('keeps provider-specific options out of custom providers', () => {
  expect(helperOptions('claude')).toMatchObject({disallowedTools: ['*']});
  expect(helperOptions('codex')).toMatchObject({sandbox_mode: 'read-only'});
  expect(helperOptions('opencode')).toEqual({permission: 'deny'});
  expect(helperOptions('custom')).toBeUndefined();
});

it('archives a timed-out helper and preserves its known usage', async () => {
  const {directory, api, helper, create} = await fixture();
  helper.waitForFinish.mockImplementationOnce(() => new Promise(() => {}));
  const execute = providerExecutor(api as unknown as Api, join(directory, 'timeout'), create, 30);
  await expect(execute('custom/vendor/model[1m]', '', '', {}, new AbortController().signal)).rejects.toThrow('timed out');
  expect(helper.archive).toHaveBeenCalledOnce();
});

it('removes only the helper project after archiving a managed helper', async () => {
  const {directory, api, helper} = await fixture();
  const cwd = join(directory, 'private-review');
  const projects = {list: vi.fn().mockResolvedValue({projects: [{projectId: 'ours', projectRootPath: cwd}, {projectId: 'other', projectRootPath: directory}]})};
  const removeProject = vi.fn().mockResolvedValue({});
  const create = managedHelper({...api, projects} as unknown as Api, removeProject);
  const agent = await create({cwd, selection: 'custom/vendor/model[1m]', instructions: '', schema: {}, prompt: ''});
  expect(api.agents.create.mock.calls[0][0]).toMatchObject({background: true});
  await agent.archive();
  expect(helper.archive).toHaveBeenCalledOnce();
  expect(removeProject.mock.calls).toEqual([['ours']]);
});
it('removes the exact temporary project if provider creation fails', async () => {
  const {directory, api} = await fixture();
  api.agents.create.mockRejectedValueOnce(new Error('Provider launch failed'));
  const projects = {list: vi.fn().mockResolvedValue({projects: [{projectId: 'ours', projectRootPath: directory}]})};
  const removeProject = vi.fn().mockResolvedValue({});
  const create = managedHelper({...api, projects} as unknown as Api, removeProject);
  await expect(create({cwd: directory, selection: 'custom/model', instructions: '', schema: {}, prompt: ''})).rejects.toThrow('launch failed');
  expect(removeProject).toHaveBeenCalledWith('ours');
});
