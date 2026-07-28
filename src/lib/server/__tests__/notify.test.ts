import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listManyMock, deleteSubsMock, sendPushMock } = vi.hoisted(() => ({
	listManyMock: vi.fn(),
	deleteSubsMock: vi.fn(),
	sendPushMock: vi.fn()
}));

vi.mock('../subs', async () => {
	const actual = await vi.importActual<typeof import('../subs')>('../subs');
	return { ...actual, list_subs_many: listManyMock, delete_subs: deleteSubsMock };
});
vi.mock('../push', async () => {
	const actual = await vi.importActual<typeof import('../push')>('../push');
	return { ...actual, send_push: sendPushMock };
});

import { notify } from '../notify';

const env = {
	VAPID_PUBLIC: 'BPub',
	VAPID_PRIVATE: 'priv',
	VAPID_SUBJECT: 'mailto:a@b'
} as never;

const sub = (ep: string, f = 'bob') => ({ s: 'ps', f, ep, k: 'K', au: 'A', d: 1 });
const payload = {
	title: 'ada',
	body: 'are you around?',
	url: '/app/chat/ada',
	conv: 'ada|bob'
};

beforeEach(() => {
	vi.clearAllMocks();
	listManyMock.mockResolvedValue([]);
	deleteSubsMock.mockResolvedValue(undefined);
	sendPushMock.mockResolvedValue({ ok: true, status: 201, gone: false });
});

describe('notify', () => {
	it('does nothing for an empty recipient list', async () => {
		expect(await notify(env, [], payload)).toMatchObject({ sent: 0 });
		expect(listManyMock).not.toHaveBeenCalled();
	});

	it('looks up every recipient’s devices in one pass', async () => {
		await notify(env, ['bob', 'cid'], payload);
		expect(listManyMock).toHaveBeenCalledWith(env, ['bob', 'cid']);
	});

	it('sends to every device a recipient has registered', async () => {
		listManyMock.mockResolvedValue([sub('https://p/phone'), sub('https://p/laptop')]);
		expect(await notify(env, ['bob'], payload)).toMatchObject({ sent: 2 });
		expect(sendPushMock).toHaveBeenCalledTimes(2);
	});

	it('sends a JSON payload the service worker can parse', async () => {
		listManyMock.mockResolvedValue([sub('https://p/phone')]);
		await notify(env, ['bob'], payload);
		expect(JSON.parse(sendPushMock.mock.calls[0][1])).toMatchObject(payload);
	});

	it('collapses a conversation with a topic, so one thread is one notification', async () => {
		listManyMock.mockResolvedValue([sub('https://p/phone')]);
		await notify(env, ['bob'], payload);
		expect(sendPushMock.mock.calls[0][3].topic).toBeTruthy();
	});

	it('prunes a subscription the push service says is gone', async () => {
		listManyMock.mockResolvedValue([sub('https://p/dead'), sub('https://p/live')]);
		sendPushMock
			.mockResolvedValueOnce({ ok: false, status: 410, gone: true })
			.mockResolvedValueOnce({ ok: true, status: 201, gone: false });
		expect(await notify(env, ['bob'], payload)).toMatchObject({ sent: 1, pruned: 1 });
		expect(deleteSubsMock).toHaveBeenCalledWith(env, ['https://p/dead']);
	});

	it('keeps a subscription that merely failed transiently', async () => {
		listManyMock.mockResolvedValue([sub('https://p/busy')]);
		sendPushMock.mockResolvedValue({ ok: false, status: 429, gone: false });
		await notify(env, ['bob'], payload);
		expect(deleteSubsMock).not.toHaveBeenCalled();
	});

	it('does nothing when nobody has ever enabled notifications', async () => {
		expect(await notify(env, ['bob'], payload)).toMatchObject({ sent: 0 });
		expect(sendPushMock).not.toHaveBeenCalled();
	});

	it('stays silent rather than throwing when VAPID is unconfigured', async () => {
		listManyMock.mockResolvedValue([sub('https://p/phone')]);
		expect(await notify({} as never, ['bob'], payload)).toMatchObject({ sent: 0 });
		expect(sendPushMock).not.toHaveBeenCalled();
	});

	it('never lets a push failure escape — a message must still be delivered', async () => {
		listManyMock.mockRejectedValue(new Error('qdrant down'));
		await expect(notify(env, ['bob'], payload)).resolves.toMatchObject({ sent: 0 });
	});
});
