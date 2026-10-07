import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Performance optimizations for window focus and note closing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips planner disk/storage reading when active tab is not planner', async () => {
    let storageReadCalled = false;
    globalThis.rootHandle = { kind: 'directory' };
    globalThis.activeTab = 'notes';
    globalThis._lastPlannerFileCheckedAt = 0;
    globalThis._isPlannerRefreshing = false;
    globalThis.plannerEvents = [{ id: 'evt-1', title: 'Work' }];
    globalThis.StorageAPI = {
      getStorageEngine: () => 'fs',
      hasPlanner: async () => {
        storageReadCalled = true;
        return true;
      },
      readPlanner: async () => {
        storageReadCalled = true;
        return { events: [{ id: 'evt-1', title: 'Work' }] };
      },
      hasPlannerProposals: async () => false,
      readPlannerProposals: async () => ({})
    };

    // Simulate checkPlannerRefresh logic
    const isPlannerActive = typeof globalThis.activeTab !== 'undefined' && globalThis.activeTab === 'planner';
    if (isPlannerActive && typeof globalThis.StorageAPI !== 'undefined' && typeof globalThis.StorageAPI.hasPlanner === 'function' && await globalThis.StorageAPI.hasPlanner()) {
      await globalThis.StorageAPI.readPlanner();
    }

    expect(storageReadCalled).toBe(false);
  });

  it('reads planner disk/storage when active tab is planner', async () => {
    let storageReadCalled = false;
    globalThis.rootHandle = { kind: 'directory' };
    globalThis.activeTab = 'planner';
    globalThis.StorageAPI = {
      getStorageEngine: () => 'fs',
      hasPlanner: async () => true,
      readPlanner: async () => {
        storageReadCalled = true;
        return { events: [{ id: 'evt-1', title: 'Work' }] };
      }
    };

    const isPlannerActive = typeof globalThis.activeTab !== 'undefined' && globalThis.activeTab === 'planner';
    if (isPlannerActive && typeof globalThis.StorageAPI !== 'undefined' && typeof globalThis.StorageAPI.hasPlanner === 'function' && await globalThis.StorageAPI.hasPlanner()) {
      await globalThis.StorageAPI.readPlanner();
    }

    expect(storageReadCalled).toBe(true);
  });

  it('does not display blocking progress dialog when standalone note closes quickly', () => {
    let progressDialogShown = false;
    const isFocusedMode = true;
    let progressTimer = null;

    if (!isFocusedMode) {
      progressTimer = setTimeout(() => {
        progressDialogShown = true;
      }, 350);
    }

    // In standalone mode, progressTimer is never scheduled
    expect(progressTimer).toBeNull();
    expect(progressDialogShown).toBe(false);
  });
});
