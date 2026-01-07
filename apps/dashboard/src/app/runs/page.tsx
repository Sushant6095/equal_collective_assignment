/**
 * Runs list page
 * Shows all runs with problematic steps highlighted
 */

import { fetchRuns, RunListItem, StepListItem } from '@/lib/api';
import Link from 'next/link';

// Helper to check if a step is problematic
function isProblematicStep(step: StepListItem): boolean {
  return step.metrics.eliminationRatio > 0.8;
}

// Helper to get problematic steps for a run
function getProblematicSteps(run: RunListItem, steps: StepListItem[]): StepListItem[] {
  return steps.filter((s) => s.runId === run.id && isProblematicStep(s));
}

export default async function RunsPage() {
  // Fetch both all runs and bad runs
  const allRuns = await fetchRuns(false);
  const badRuns = await fetchRuns(true);
  
  // For each run, we'd need to fetch steps to identify problematic ones
  // For MVP, we'll highlight runs that are in the bad filter list
  const badRunIds = new Set(badRuns.map((r) => r.id));

  return (
    <div>
      <h1>X-Ray Runs</h1>
      <p>Total runs: {allRuns.length} | Problematic runs: {badRuns.length}</p>
      
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Run ID</th>
            <th style={{ padding: '8px' }}>Pipeline</th>
            <th style={{ padding: '8px' }}>Status</th>
            <th style={{ padding: '8px' }}>Started</th>
            <th style={{ padding: '8px' }}>Steps</th>
            <th style={{ padding: '8px' }}>Input</th>
            <th style={{ padding: '8px' }}>Output</th>
            <th style={{ padding: '8px' }}>Elimination Ratio</th>
            <th style={{ padding: '8px' }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {allRuns.map((run) => {
            const isProblematic = badRunIds.has(run.id);
            const eliminationRatio = run.metrics.overallEliminationRatio;
            const isHighElimination = eliminationRatio > 0.8;
            
            return (
              <tr
                key={run.id}
                style={{
                  borderBottom: '1px solid #eee',
                  backgroundColor: isProblematic || isHighElimination ? '#fff3cd' : 'transparent',
                }}
              >
                <td style={{ padding: '8px' }}>
                  <Link href={`/runs/${run.id}`} style={{ color: '#0066cc' }}>
                    {run.id.slice(0, 8)}...
                  </Link>
                </td>
                <td style={{ padding: '8px' }}>{run.pipelineId}</td>
                <td style={{ padding: '8px' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor:
                        run.status === 'completed'
                          ? '#d4edda'
                          : run.status === 'failed'
                          ? '#f8d7da'
                          : '#fff3cd',
                      color:
                        run.status === 'completed'
                          ? '#155724'
                          : run.status === 'failed'
                          ? '#721c24'
                          : '#856404',
                    }}
                  >
                    {run.status}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td style={{ padding: '8px' }}>{run.metrics.totalSteps}</td>
                <td style={{ padding: '8px' }}>{run.metrics.totalInputCount.toLocaleString()}</td>
                <td style={{ padding: '8px' }}>{run.metrics.totalOutputCount.toLocaleString()}</td>
                <td
                  style={{
                    padding: '8px',
                    color: isHighElimination ? '#dc3545' : 'inherit',
                    fontWeight: isHighElimination ? 'bold' : 'normal',
                  }}
                >
                  {(eliminationRatio * 100).toFixed(1)}%
                </td>
                <td style={{ padding: '8px', color: run.error ? '#dc3545' : '#6c757d' }}>
                  {run.error ? 'Yes' : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

