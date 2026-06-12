/**
 * Placeholder creation: API client call shape and error mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../types';
import { formatApiError } from '../utils/errors';

const postMock = vi.fn();

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

describe('lookupsApi.createPlaceholder', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('posts to the planning-level /placeholders endpoint with the cost center and name', async () => {
    const created = {
      id: 'ph-1',
      tenant_id: 't-1',
      name: 'TBD Senior Engineer',
      cost_center_id: 'cc-1',
      cost_center_name: 'Engineering',
      description: null,
      skill_profile: null,
      estimated_cost: null,
      created_by: 'user-1',
      is_active: true,
      created_at: '2026-06-12T00:00:00Z',
      updated_at: '2026-06-12T00:00:00Z',
    };
    postMock.mockResolvedValue(created);

    const { lookupsApi } = await import('../api/lookups');
    const result = await lookupsApi.createPlaceholder({
      cost_center_id: 'cc-1',
      name: 'TBD Senior Engineer',
    });

    expect(postMock).toHaveBeenCalledWith('/placeholders', {
      cost_center_id: 'cc-1',
      name: 'TBD Senior Engineer',
    });
    expect(result.id).toBe('ph-1');
    expect(result.created_by).toBe('user-1');
  });
});

describe('placeholder error mapping', () => {
  it('maps PLACEHOLDER_EXISTS to a friendly message', () => {
    const error = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'PLACEHOLDER_EXISTS',
      detail: 'This cost center already has a placeholder with that name.',
    });
    const formatted = formatApiError(error, 'Create placeholder');
    expect(formatted).toContain('already has a placeholder with that name');
    expect(formatted).toContain('PLACEHOLDER_EXISTS');
  });
});
