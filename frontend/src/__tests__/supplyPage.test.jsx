import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Supply } from '../pages/Supply';
import { lookupsApi } from '../api/lookups';

const mockSupplies = vi.hoisted(() => [
  {
    id: 's1',
    project_id: 'p1',
    project_name: 'Project Alpha',
    cost_center_id: 'cc1',
    cost_center_name: 'Cost Center 1',
    resource_id: 'r1',
    resource_name: 'Alice',
    year: 2026,
    month: 2,
    fte_percent: 80,
  },
]);

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'Manager' } }),
}));

vi.mock('../contexts/PeriodContext', () => ({
  usePeriod: () => ({
    selectedPeriodId: 'period-1',
    selectedPeriod: { id: 'period-1', year: 2026, month: 2, status: 'open' },
  }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showApiError: vi.fn(),
  }),
}));

vi.mock('../api/planning', () => ({
  planningApi: {
    getSupplyLines: vi.fn().mockResolvedValue(mockSupplies),
    createSupplyLine: vi.fn(),
    updateSupplyLine: vi.fn(),
    deleteSupplyLine: vi.fn(),
    bulkSupplyLines: vi.fn(),
  },
}));

vi.mock('../api/lookups', () => ({
  lookupsApi: {
    listResources: vi.fn().mockResolvedValue([
      { id: 'r1', display_name: 'Alice' },
    ]),
    listResourcesScoped: vi.fn().mockResolvedValue([
      { id: 'r1', display_name: 'Alice' },
    ]),
    listProjects: vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Project Alpha' },
    ]),
    listProjectsScoped: vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Project Alpha' },
    ]),
    listCostCenters: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../api/periods', () => ({
  periodsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

describe('Supply page', () => {
  it('renders header, KPIs, and supply table', async () => {
    render(<Supply />);

    await waitFor(() =>
      expect(screen.getByText(/Supply Planning/i)).toBeInTheDocument(),
    );

    expect(screen.getByText(/Total FTE%/i)).toBeInTheDocument();
    expect(screen.getByText(/Distinct resources/i)).toBeInTheDocument();
    expect(screen.getByText(/Supply Lines/)).toBeInTheDocument();
  });

  it('RO role uses listResourcesScoped instead of listResources', async () => {
    render(<Supply />);

    await waitFor(() =>
      expect(screen.getByText(/Supply Planning/i)).toBeInTheDocument(),
    );

    expect(vi.mocked(lookupsApi.listResourcesScoped)).toHaveBeenCalled();
    expect(vi.mocked(lookupsApi.listResources)).not.toHaveBeenCalled();
  });
});
