/**
 * Run detail page
 * Shows step timeline with drill-down capability
 */

import { fetchRun, RunDetail, StepListItem } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

// Helper to check if a step is problematic
function isProblematicStep(step: StepListItem): boolean {
  return step.metrics.eliminationRatio > 0.8;
}

// Helper to format duration
function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return 'Running...';
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const ms = end - start;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export default async function RunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let run: RunDetail;
  
  try {
    run = await fetchRun(params.id);
  } catch (error) {
    notFound();
  }

  const problematicSteps = run.steps.filter(isProblematicStep);

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/runs" style={{ color: '#0066cc', textDecoration: 'none' }}>
          ← Back to Runs
        </Link>
      </div>

      <h1>Run: {run.id.slice(0, 8)}...</h1>
      
      <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <div><strong>Pipeline:</strong> {run.pipelineId}</div>
        <div><strong>Status:</strong> {run.status}</div>
        <div><strong>Started:</strong> {new Date(run.startedAt).toLocaleString()}</div>
        {run.completedAt && (
          <div><strong>Completed:</strong> {new Date(run.completedAt).toLocaleString()}</div>
        )}
        {run.error && (
          <div style={{ color: '#dc3545', marginTop: '8px' }}>
            <strong>Error:</strong> {run.error}
          </div>
        )}
        <div style={{ marginTop: '8px' }}>
          <strong>Metrics:</strong> {run.metrics.totalInputCount.toLocaleString()} →{' '}
          {run.metrics.totalOutputCount.toLocaleString()} (
          {(run.metrics.overallEliminationRatio * 100).toFixed(1)}% eliminated)
        </div>
        {problematicSteps.length > 0 && (
          <div style={{ marginTop: '8px', color: '#dc3545' }}>
            <strong>⚠ {problematicSteps.length} problematic step(s)</strong>
          </div>
        )}
      </div>

      <h2>Step Timeline</h2>
      
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Step</th>
            <th style={{ padding: '8px' }}>Type</th>
            <th style={{ padding: '8px' }}>Duration</th>
            <th style={{ padding: '8px' }}>Input</th>
            <th style={{ padding: '8px' }}>Output</th>
            <th style={{ padding: '8px' }}>Elimination Ratio</th>
            <th style={{ padding: '8px' }}>Kept</th>
            <th style={{ padding: '8px' }}>Eliminated</th>
            <th style={{ padding: '8px' }}>Scored</th>
            <th style={{ padding: '8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {run.steps.map((step, index) => {
            const isProblematic = isProblematicStep(step);
            const eliminationRatio = step.metrics.eliminationRatio;
            
            return (
              <tr
                key={step.id}
                style={{
                  borderBottom: '1px solid #eee',
                  backgroundColor: isProblematic ? '#fff3cd' : 'transparent',
                }}
              >
                <td style={{ padding: '8px' }}>
                  <strong>{step.name}</strong>
                  {isProblematic && (
                    <span style={{ marginLeft: '8px', color: '#dc3545' }}>⚠</span>
                  )}
                </td>
                <td style={{ padding: '8px' }}>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: '#e9ecef',
                      fontSize: '12px',
                    }}
                  >
                    {step.type}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>
                  {formatDuration(step.startedAt, step.completedAt)}
                </td>
                <td style={{ padding: '8px' }}>
                  {step.metrics.inputCount.toLocaleString()}
                </td>
                <td style={{ padding: '8px' }}>
                  {step.metrics.outputCount.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: '8px',
                    color: isProblematic ? '#dc3545' : 'inherit',
                    fontWeight: isProblematic ? 'bold' : 'normal',
                  }}
                >
                  {(eliminationRatio * 100).toFixed(1)}%
                </td>
                <td style={{ padding: '8px', color: '#28a745' }}>
                  {step.metrics.keptCount.toLocaleString()}
                </td>
                <td style={{ padding: '8px', color: '#dc3545' }}>
                  {step.metrics.eliminatedCount.toLocaleString()}
                </td>
                <td style={{ padding: '8px', color: '#ffc107' }}>
                  {step.metrics.scoredCount.toLocaleString()}
                </td>
                <td style={{ padding: '8px' }}>
                  <Link
                    href={`/runs/${run.id}/steps/${step.id}`}
                    style={{ color: '#0066cc', textDecoration: 'none' }}
                  >
                    View Details →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

