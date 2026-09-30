import { useCallback, useRef, useState } from 'react';

import { reportsApi } from './reports.api.js';

/**
 * State for the "View" dialog: which report, with which filters, and whether
 * it has loaded. Shared by Inventory, the till reports and the Reports tab.
 *
 * A request that finishes after the dialog was reopened for a different report
 * is discarded — otherwise a slow first click could paint over a fast second.
 */
export function useReportViewer() {
  const [state, setState] = useState({
    isOpen: false,
    report: null,
    isLoading: false,
    error: null,
    reportId: null,
    params: null,
  });
  const requestId = useRef(0);

  const open = useCallback(async (reportId, params) => {
    const id = ++requestId.current;
    setState({ isOpen: true, report: null, isLoading: true, error: null, reportId, params });
    try {
      const report = await reportsApi.run(reportId, params);
      if (id === requestId.current) setState((s) => ({ ...s, report, isLoading: false }));
    } catch (error) {
      if (id === requestId.current) setState((s) => ({ ...s, error, isLoading: false }));
    }
  }, []);

  const close = useCallback(() => setState((s) => ({ ...s, isOpen: false })), []);

  return { ...state, open, close };
}

export default useReportViewer;
