import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Demand } from '../pages/Demand';
import { lookupsApi } from '../api/lookups';

const mockDemands = vi.hoisted(() => [
  {
    id: 'd1',
    project_id: 'p1',
    project_name: 'Project Alpha',
    cost_center_id: 'cc1',
    cost_center_name: 'Cost Center 1',
    resource_id: 'r1',
    resource_name: 'Alice',
    year: 2026,
    month: 2,
    fte_percent: 50,
  },
]);

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'Finance' } }),
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
    getDemandLines: vi.fn().mockResolvedValue(mockDemands),
    createDemandLine: vi.fn(),
    updateDemandLine: vi.fn(),
    deleteDemandLine: vi.fn(),
    bulkDemandLines: vi.fn(),
  },
}));

vi.mock('../api/lookups', () => ({
  lookupsApi: {
    listProjects: vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Project Alpha' },
    ]),
    listProjectsScoped: vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Project Alpha' },
    ]),
    listResources: vi.fn().mockResolvedValue([
      { id: 'r1', display_name: 'Alice' },
    ]),
    listPlaceholders: vi.fn().mockResolvedValue([]),
    listCostCenters: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../api/periods', () => ({
  periodsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

describe('Demand page', () => {
  it('renders header, KPIs, and demand table', async () => {
    render(<Demand />);

    await waitFor(() =>
      expect(screen.getByText(/Demand Planning/i)).toBeInTheDocument(),
    );

    expect(screen.getByText(/Total FTE%/i)).toBeInTheDocument();
    expect(screen.getByText(/Distinct projects/i)).toBeInTheDocument();
    expect(screen.getByText(/Demand Lines/)).toBeInTheDocument();
  });

  it('Finance role uses listProjects (not scoped)', async () => {
    render(<Demand />);

    await waitFor(() =>
      expect(screen.getByText(/Demand Planning/i)).toBeInTheDocument(),
    );

    expect(vi.mocked(lookupsApi.listProjects)).toHaveBeenCalled();
    expect(vi.mocked(lookupsApi.listProjectsScoped)).not.toHaveBeenCalled();
  });
});
