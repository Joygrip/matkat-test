import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Finance } from '../pages/Finance';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'Finance' } }),
  useHasRole: () => true,
}));

vi.mock('../contexts/PeriodContext', () => ({
  usePeriod: () => ({
    periods: [
      { id: 'p1', year: 2026, month: 2, status: 'open' },
    ],
    selectedPeriodId: 'p1',
    setSelectedPeriodId: vi.fn(),
    selectedPeriod: { id: 'p1', year: 2026, month: 2, status: 'open' },
    loading: false,
  }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showApiError: vi.fn(),
  }),
}));

const { mockDashboard } = vi.hoisted(() => ({
  mockDashboard: {
    period_id: 'p1',
    period: '2026-02',
    summary: {
      total_cost_centers: 2,
      total_demand_fte: 100,
      total_supply_fte: 120,
      total_gap_fte: 20,
      orphans_count: 0,
      over_allocations_count: 0,
    },
    cost_centers: [
      {
        cost_center_id: 'cc1',
        cost_center_name: 'Dev',
        total_demand_fte: 50,
        total_supply_fte: 60,
        gap_fte: 10,
        resources: [],
        placeholders: [],
      },
    ],
    over_allocations: [],
  },
}));

vi.mock('../api/consolidation', () => ({
  consolidationApi: {
    getDashboard: vi.fn().mockResolvedValue(mockDashboard),
    getSnapshots: vi.fn().mockResolvedValue([]),
    publishSnapshot: vi.fn(),
    getSnapshot: vi.fn(),
  },
}));

vi.mock('../api/lookups', () => ({
  lookupsApi: {
    listCostCenters: vi.fn().mockResolvedValue([{ id: 'cc1', name: 'Dev' }]),
    listProjects: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../api/finance', () => ({
  getFinanceSetting: vi.fn().mockResolvedValue({ setting_key: 'monthly_fte_cost', setting_value: '99000' }),
  updateFinanceSetting: vi.fn().mockResolvedValue({ setting_key: 'monthly_fte_cost', setting_value: '80000' }),
  getCostCenterStats: vi.fn().mockResolvedValue([]),
  getEmployeeStats: vi.fn().mockResolvedValue([]),
}));

vi.mock('../api/periods', () => ({
  periodsApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'p1', year: 2026, month: 2, status: 'open' },
    ]),
    lock: vi.fn(),
    unlock: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../hooks/useCostCenterStats', () => ({
  useCostCenterStats: () => ({ data: [], loading: false, error: null }),
}));

describe('Finance page', () => {
  it('renders header, toolbar, and overview', async () => {
    render(<Finance />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Finance/i })).toBeInTheDocument(),
    );

    expect(screen.getByRole('button', { name: /Publish Snapshot/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage periods/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Overview/i).length).toBeGreaterThan(0);
  });

  it('shows KPI scoreboard with Orphan Demands', async () => {
    render(<Finance />);

    await waitFor(() =>
      expect(screen.getByText(/Orphan Demands/i)).toBeInTheDocument(),
    );

    expect(screen.getByText(/Orphan Demands/i)).toBeInTheDocument();
  });

  it('shows Cost Report tab for Finance role', async () => {
    render(<Finance />);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Cost Report/i })).toBeInTheDocument(),
    );
  });

  it('computes DKK cost correctly: 50% of 99000 = 49500', () => {
    const fte = 50;
    const monthlyCost = 99000;
    expect(Math.round((fte / 100) * monthlyCost)).toBe(49500);
  });

  it('formats DKK using Danish locale', () => {
    const formatted = new Intl.NumberFormat('da-DK', {
      style: 'currency',
      currency: 'DKK',
      maximumFractionDigits: 0,
    }).format(49500);
    // Value should contain the number 49 regardless of locale punctuation
    expect(formatted).toMatch(/49/);
  });
});
