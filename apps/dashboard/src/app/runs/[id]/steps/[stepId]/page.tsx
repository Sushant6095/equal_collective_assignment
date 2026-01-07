/**
 * Step detail page
 * Drill-down view for a specific step
 */

import { fetchStep, StepDetail, DecisionEventReference } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function StepDetailPage({
  params,
}: {
  params: { id: string; stepId: string };
}) {
  let step: StepDetail;
  
  try {
    step = await fetchStep(params.stepId);
  } catch (error) {
    notFound();
  }

  const isProblematic = step.metrics.eliminationRatio > 0.8;

  // Group decision events by outcome
  const byOutcome = {
    kept: step.decisionEvents.filter((e) => e.outcome === 'kept'),
    eliminated: step.decisionEvents.filter((e) => e.outcome === 'eliminated'),
    scored: step.decisionEvents.filter((e) => e.outcome === 'scored'),
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link
          href={`/runs/${params.id}`}
          style={{ color: '#0066cc', textDecoration: 'none' }}
        >
          ← Back to Run
        </Link>
      </div>

      <h1>Step: {step.name}</h1>
      
      <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <div><strong>Step ID:</strong> {step.id}</div>
        <div><strong>Type:</strong> {step.type}</div>
        <div><strong>Run ID:</strong> {step.runId}</div>
        <div><strong>Pipeline:</strong> {step.pipelineId}</div>
        <div><strong>Started:</strong> {new Date(step.startedAt).toLocaleString()}</div>
        {step.completedAt && (
          <div><strong>Completed:</strong> {new Date(step.completedAt).toLocaleString()}</div>
        )}
        {isProblematic && (
          <div style={{ marginTop: '8px', color: '#dc3545' }}>
            <strong>⚠ High elimination ratio: {(step.metrics.eliminationRatio * 100).toFixed(1)}%</strong>
          </div>
        )}
      </div>

      <h2>Metrics</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', marginBottom: '30px' }}>
        <tbody>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>Input Count</td>
            <td style={{ padding: '8px' }}>{step.metrics.inputCount.toLocaleString()}</td>
          </tr>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>Output Count</td>
            <td style={{ padding: '8px' }}>{step.metrics.outputCount.toLocaleString()}</td>
          </tr>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>Elimination Ratio</td>
            <td
              style={{
                padding: '8px',
                color: isProblematic ? '#dc3545' : 'inherit',
                fontWeight: isProblematic ? 'bold' : 'normal',
              }}
            >
              {(step.metrics.eliminationRatio * 100).toFixed(1)}%
            </td>
          </tr>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>Kept</td>
            <td style={{ padding: '8px', color: '#28a745' }}>
              {step.metrics.keptCount.toLocaleString()}
            </td>
          </tr>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>Eliminated</td>
            <td style={{ padding: '8px', color: '#dc3545' }}>
              {step.metrics.eliminatedCount.toLocaleString()}
            </td>
          </tr>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>Scored</td>
            <td style={{ padding: '8px', color: '#ffc107' }}>
              {step.metrics.scoredCount.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Decision Events ({step.decisionEvents.length})</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <span style={{ marginRight: '16px' }}>
          <strong>Kept:</strong> {byOutcome.kept.length}
        </span>
        <span style={{ marginRight: '16px', color: '#dc3545' }}>
          <strong>Eliminated:</strong> {byOutcome.eliminated.length}
        </span>
        <span style={{ color: '#ffc107' }}>
          <strong>Scored:</strong> {byOutcome.scored.length}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Event ID</th>
            <th style={{ padding: '8px' }}>Item ID</th>
            <th style={{ padding: '8px' }}>Outcome</th>
            <th style={{ padding: '8px' }}>Score</th>
            <th style={{ padding: '8px' }}>Timestamp</th>
            <th style={{ padding: '8px' }}>S3 Key</th>
          </tr>
        </thead>
        <tbody>
          {step.decisionEvents.map((event) => (
            <tr key={event.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                {event.id.slice(0, 8)}...
              </td>
              <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                {event.itemId}
              </td>
              <td style={{ padding: '8px' }}>
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor:
                      event.outcome === 'kept'
                        ? '#d4edda'
                        : event.outcome === 'eliminated'
                        ? '#f8d7da'
                        : '#fff3cd',
                    color:
                      event.outcome === 'kept'
                        ? '#155724'
                        : event.outcome === 'eliminated'
                        ? '#721c24'
                        : '#856404',
                    fontSize: '12px',
                  }}
                >
                  {event.outcome}
                </span>
              </td>
              <td style={{ padding: '8px' }}>
                {event.score !== null ? event.score.toFixed(3) : '-'}
              </td>
              <td style={{ padding: '8px', fontSize: '12px' }}>
                {new Date(event.timestamp).toLocaleString()}
              </td>
              <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', color: '#6c757d' }}>
                {event.s3Key}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

