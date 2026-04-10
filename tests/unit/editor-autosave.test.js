import { createAutosaveController } from '../../public/js/editor/autosave.js';

describe('editor autosave controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid changes into a single debounced save with the latest payload', async () => {
    const save = vi.fn(async (payload) => ({
      headUpdatedAt: '2026-04-10T12:00:00.000Z',
      payload
    }));

    const controller = createAutosaveController({
      delayMs: 2000,
      save
    });

    controller.reset();
    controller.markDirty({ document: { blocks: [{ id: 'blk_1' }] } });
    controller.markDirty({ document: { blocks: [{ id: 'blk_2' }] } });

    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      { document: { blocks: [{ id: 'blk_2' }] } },
      'debounced'
    );
    expect(controller.getState().status).toBe('saved');
  });
});
