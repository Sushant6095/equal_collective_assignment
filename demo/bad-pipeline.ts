/**
 * Bad Pipeline Demo - Competitor Selection
 * 
 * This pipeline intentionally over-filters candidates to demonstrate
 * debugging capabilities in the X-Ray dashboard.
 * 
 * Problem: The keyword filter is too aggressive, eliminating good candidates.
 * This should be visible in the dashboard as a high elimination ratio.
 */

import { XRay, CaptureLevel } from '@xray/sdk-core';
import { XRStepType, XRDecisionOutcome } from '@xray/shared-types';


// Types for competitor selection
interface Competitor {
  id: string;
  name: string;
  industry: string;
  description: string;
  revenue: number;
  employees: number;
  keywords: string[];
}

interface KeywordSet {
  keywords: string[];
  confidence: number;
}

interface ScoredCompetitor extends Competitor {
  relevanceScore: number;
}

/**
 * Simulate a competitor selection pipeline with intentional bugs
 */
async function runBadPipeline() {
  // Initialize X-Ray SDK
  const xray = new XRay({
    apiUrl: process.env.INGESTION_API_URL || 'http://localhost:3000',
    captureLevel: CaptureLevel.SAMPLED, // Sample events for efficiency
  });

  // Initial candidate pool
  const candidates: Competitor[] = [
    {
      id: 'comp-1',
      name: 'TechCorp Inc',
      industry: 'Software',
      description: 'Enterprise software solutions for large businesses',
      revenue: 50000000,
      employees: 500,
      keywords: ['enterprise', 'software', 'saas', 'cloud'],
    },
    {
      id: 'comp-2',
      name: 'StartupXYZ',
      industry: 'Software',
      description: 'Modern SaaS platform for small businesses',
      revenue: 5000000,
      employees: 50,
      keywords: ['saas', 'startup', 'small-business', 'modern'],
    },
    {
      id: 'comp-3',
      name: 'DataSystems Ltd',
      industry: 'Data Analytics',
      description: 'Big data analytics and machine learning solutions',
      revenue: 30000000,
      employees: 300,
      keywords: ['analytics', 'big-data', 'machine-learning', 'ai'],
    },
    {
      id: 'comp-4',
      name: 'CloudServices Co',
      industry: 'Infrastructure',
      description: 'Cloud infrastructure and DevOps tools',
      revenue: 80000000,
      employees: 800,
      keywords: ['cloud', 'infrastructure', 'devops', 'aws'],
    },
    {
      id: 'comp-5',
      name: 'MobileApps Inc',
      industry: 'Mobile',
      description: 'Mobile app development and consulting',
      revenue: 15000000,
      employees: 150,
      keywords: ['mobile', 'apps', 'ios', 'android'],
    },
    {
      id: 'comp-6',
      name: 'EnterpriseSoft',
      industry: 'Software',
      description: 'Enterprise software with focus on security',
      revenue: 120000000,
      employees: 1200,
      keywords: ['enterprise', 'security', 'compliance', 'software'],
    },
    {
      id: 'comp-7',
      name: 'AI Solutions',
      industry: 'AI/ML',
      description: 'Artificial intelligence and machine learning platforms',
      revenue: 40000000,
      employees: 400,
      keywords: ['ai', 'machine-learning', 'nlp', 'computer-vision'],
    },
    {
      id: 'comp-8',
      name: 'DevTools Pro',
      industry: 'Developer Tools',
      description: 'Developer tools and productivity software',
      revenue: 25000000,
      employees: 250,
      keywords: ['developer-tools', 'productivity', 'git', 'ci-cd'],
    },
  ];

  console.log(`Starting pipeline with ${candidates.length} candidates`);

  // Start run
  const runId = await xray.startRun('competitor-selection', {
    targetIndustry: 'Software',
    minRevenue: 10000000,
    searchContext: 'Looking for enterprise software competitors',
  });

  try {
    // Step 1: Generate keywords (LLM step)
    // BUG: This generates too many keywords, making filtering too strict
    const keywordSet = await xray.step(
      runId,
      XRStepType.LLM,
      'generate-search-keywords',
      async (input: { searchContext: string }) => {
        // Simulate LLM generating keywords
        // BUG: Generates too many specific keywords
        const keywords = [
          'enterprise',
          'software',
          'saas',
          'cloud',
          'security', // Too specific - eliminates many candidates
          'compliance', // Too specific
          'enterprise-grade', // Too specific
        ];

        // Return as if each keyword is a decision
        return keywords.map((keyword, index) => ({
          itemId: `keyword-${index}`,
          outcome: XRDecisionOutcome.SCORED,
          input: { searchContext: input.searchContext },
          output: { keyword },
          reason: `Generated keyword: ${keyword}`,
          score: 0.9 - index * 0.1, // Decreasing confidence
        }));
      },
      { searchContext: 'Looking for enterprise software competitors' },
      { model: 'gpt-4', temperature: 0.7 }
    );

    // Extract keywords from the scored results
    const searchKeywords = keywordSet
      .map((k: any) => k.output?.keyword)
      .filter(Boolean) as string[];
    console.log(`Generated ${searchKeywords.length} keywords:`, searchKeywords);

    // Step 2: Filter by keywords (FILTER step)
    // BUG: Requires ALL keywords to match (too strict)
    const filtered = await xray.step(
      runId,
      XRStepType.FILTER,
      'filter-by-keywords',
      async (input: Competitor[]) => {
        // BUG: Requires candidate to have ALL keywords (too strict)
        // Should require only SOME keywords
        return input.map((candidate) => {
          const hasAllKeywords = searchKeywords.every((keyword) =>
            candidate.keywords.some((k) =>
              k.toLowerCase().includes(keyword.toLowerCase())
            )
          );

          if (!hasAllKeywords) {
            return {
              itemId: candidate.id,
              outcome: XRDecisionOutcome.ELIMINATED,
              input: candidate,
              output: null,
              reason: `Missing required keywords. Has: ${candidate.keywords.join(', ')}, Required: ${searchKeywords.join(', ')}`,
            };
          }

          return {
            itemId: candidate.id,
            outcome: XRDecisionOutcome.KEPT,
            input: candidate,
            output: candidate,
            reason: `Matches all required keywords: ${candidate.keywords.join(', ')}`,
          };
        });
      },
      candidates,
      {
        matchType: 'all', // BUG: Should be 'any' or 'some'
        keywords: searchKeywords,
      }
    );

    const keptCandidates = filtered.filter((f: any) => f.outcome === XRDecisionOutcome.KEPT);
    console.log(`After keyword filter: ${keptCandidates.length} candidates kept`);

    // Step 3: Filter by revenue (FILTER step)
    // BUG: Threshold is too high
    const revenueFiltered = await xray.step(
      runId,
      XRStepType.FILTER,
      'filter-by-revenue',
      async (input: any[]) => {
        // Extract kept candidates from previous step
        const candidates = input
          .filter((f: any) => f.outcome === XRDecisionOutcome.KEPT)
          .map((f: any) => f.output)
          .filter(Boolean) as Competitor[];
        
        const threshold = 50000000; // BUG: Too high, eliminates good candidates

        return candidates.map((candidate) => {
          if (candidate.revenue < threshold) {
            return {
              itemId: candidate.id,
              outcome: XRDecisionOutcome.ELIMINATED,
              input: candidate,
              output: null,
              reason: `Revenue $${candidate.revenue.toLocaleString()} below threshold $${threshold.toLocaleString()}`,
            };
          }

          return {
            itemId: candidate.id,
            outcome: XRDecisionOutcome.KEPT,
            input: candidate,
            output: candidate,
            reason: `Revenue $${candidate.revenue.toLocaleString()} meets threshold`,
          };
        });
      },
      filtered,
      { threshold: 50000000 }
    );

    const afterRevenue = revenueFiltered.filter((f: any) => f.outcome === XRDecisionOutcome.KEPT);
    console.log(`After revenue filter: ${afterRevenue.length}/${keptCandidates.length} candidates kept`);

    // Step 4: Rank by relevance (RANK step)
    const ranked = await xray.step(
      runId,
      XRStepType.RANK,
      'rank-by-relevance',
      async (input: any[]) => {
        // Extract kept candidates from previous step
        const candidates = input
          .filter((f: any) => f.outcome === XRDecisionOutcome.KEPT)
          .map((f: any) => f.output)
          .filter(Boolean) as Competitor[];

        // Score based on keyword matches and revenue
        return candidates.map((candidate) => {
          const keywordMatches = searchKeywords.filter((keyword) =>
            candidate.keywords.some((k) =>
              k.toLowerCase().includes(keyword.toLowerCase())
            )
          ).length;

          const relevanceScore =
            (keywordMatches / searchKeywords.length) * 0.7 +
            Math.min(candidate.revenue / 100000000, 1) * 0.3;

          return {
            itemId: candidate.id,
            outcome: XRDecisionOutcome.SCORED,
            input: candidate,
            output: { ...candidate, relevanceScore },
            reason: `Relevance score: ${relevanceScore.toFixed(3)} (${keywordMatches}/${searchKeywords.length} keywords, revenue: $${candidate.revenue.toLocaleString()})`,
            score: relevanceScore,
          };
        });
      },
      revenueFiltered,
      { scoringMethod: 'weighted' }
    );

    // Sort by score
    const sorted = ranked
      .map((r: any) => r.output)
      .filter(Boolean)
      .sort((a: ScoredCompetitor, b: ScoredCompetitor) => b.relevanceScore - a.relevanceScore);

    console.log(`Final ranked results: ${sorted.length} competitors`);
    sorted.forEach((c: ScoredCompetitor, index: number) => {
      console.log(
        `${index + 1}. ${c.name} - Score: ${c.relevanceScore.toFixed(3)}, Revenue: $${c.revenue.toLocaleString()}`
      );
    });

    // End run
    await xray.endRun(runId, {
      totalCandidates: candidates.length,
      finalResults: sorted.length,
      eliminationRatio: 1 - sorted.length / candidates.length,
      results: sorted,
    });

    // Flush events
    await xray.flush();

    console.log('\n=== Pipeline Summary ===');
    console.log(`Input: ${candidates.length} candidates`);
    console.log(`Output: ${sorted.length} competitors`);
    console.log(`Elimination Ratio: ${((1 - sorted.length / candidates.length) * 100).toFixed(1)}%`);
    console.log('\n⚠️  PROBLEM: Pipeline eliminated too many candidates!');
    console.log('   - Keyword filter requires ALL keywords (too strict)');
    console.log('   - Revenue threshold too high');
    console.log('   - Check dashboard to see where candidates were eliminated');

    return sorted;
  } catch (error) {
    await xray.endRun(runId, null, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// Run the pipeline
if (require.main === module) {
  runBadPipeline()
    .then(() => {
      console.log('\n✅ Pipeline completed. Check dashboard at http://localhost:3000/runs');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Pipeline failed:', error);
      process.exit(1);
    });
}

export { runBadPipeline };

