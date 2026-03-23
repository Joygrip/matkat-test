import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { AdminToolbar } from '../AdminToolbar';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('AdminToolbar', () => {
  it('renders the search input', () => {
    wrap(
      <AdminToolbar searchValue="" onSearchChange={vi.fn()} onClear={vi.fn()} />
    );
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('uses custom search placeholder', () => {
    wrap(
      <AdminToolbar
        searchValue=""
        onSearchChange={vi.fn()}
        onClear={vi.fn()}
        searchPlaceholder="Search by name…"
      />
    );
    expect(screen.getByPlaceholderText('Search by name…')).toBeInTheDocument();
  });

  it('calls onSearchChange when user types', () => {
    const onSearchChange = vi.fn();
    wrap(
      <AdminToolbar
        searchValue=""
        onSearchChange={onSearchChange}
        onClear={vi.fn()}
        searchPlaceholder="Search..."
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Search...'), {
      target: { value: 'hello' },
    });
    expect(onSearchChange).toHaveBeenCalledWith('hello');
  });

  it('does not show Clear button when filters are empty', () => {
    wrap(
      <AdminToolbar searchValue="" onSearchChange={vi.fn()} onClear={vi.fn()} />
    );
    expect(screen.queryByTitle('Clear filters')).not.toBeInTheDocument();
  });

  it('shows Clear button when search has a value', () => {
    wrap(
      <AdminToolbar searchValue="foo" onSearchChange={vi.fn()} onClear={vi.fn()} />
    );
    expect(screen.getByTitle('Clear filters')).toBeInTheDocument();
  });

  it('calls onClear when Clear button is clicked', () => {
    const onClear = vi.fn();
    wrap(
      <AdminToolbar searchValue="foo" onSearchChange={vi.fn()} onClear={onClear} />
    );
    fireEvent.click(screen.getByTitle('Clear filters'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders filter dropdown when filterOptions are provided', () => {
    wrap(
      <AdminToolbar
        searchValue=""
        onSearchChange={vi.fn()}
        onClear={vi.fn()}
        filterValue=""
        onFilterChange={vi.fn()}
        filterOptions={[
          { value: 'active', label: 'Active' },
          { value: 'on_hold', label: 'On Hold' },
        ]}
        filterPlaceholder="All statuses"
      />
    );
    expect(screen.getByText('All statuses')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
  });

  it('calls onFilterChange when filter selection changes', () => {
    const onFilterChange = vi.fn();
    wrap(
      <AdminToolbar
        searchValue=""
        onSearchChange={vi.fn()}
        onClear={vi.fn()}
        filterValue=""
        onFilterChange={onFilterChange}
        filterOptions={[{ value: 'active', label: 'Active' }]}
      />
    );
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'active' } });
    expect(onFilterChange).toHaveBeenCalledWith('active');
  });

  it('shows Clear when filter has a value', () => {
    wrap(
      <AdminToolbar
        searchValue=""
        onSearchChange={vi.fn()}
        onClear={vi.fn()}
        filterValue="active"
        onFilterChange={vi.fn()}
        filterOptions={[{ value: 'active', label: 'Active' }]}
      />
    );
    expect(screen.getByTitle('Clear filters')).toBeInTheDocument();
  });
});
