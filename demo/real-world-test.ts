/**
 * Real-World Test: E-Commerce Product Filtering Pipeline
 * 
 * This demonstrates the X-Ray SDK with a realistic use case:
 * Filtering and ranking products for an e-commerce search
 * 
 * Run: npm run real-world-test
 */

import { XRay, CaptureLevel } from '@xray/sdk-core';
import { XRStepType } from '@xray/shared-types';

// Real-world data structure
interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  rating: number;
  inStock: boolean;
  tags: string[];
}

interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  categories?: string[];
  minRating?: number;
  inStockOnly?: boolean;
}

/**
 * Real-world pipeline: Product search and filtering
 * This is how a developer would actually use the SDK
 */
async function productSearchPipeline(
  products: Product[],
  filters: SearchFilters
) {
  // Initialize SDK (developer does this once)
  const xray = new XRay({
    apiUrl: process.env.INGESTION_API_URL || 'http://localhost:3002',
    captureLevel: CaptureLevel.SAMPLED,
  });

  console.log(`\n🔍 Starting product search with ${products.length} products`);
  console.log(`Filters:`, filters);

  // Start tracking
  const runId = await xray.startRun('product-search', products, {
    filters,
    timestamp: new Date().toISOString(),
  });

  try {
    // Step 1: Filter by price (real business logic - no SDK changes needed!)
    const priceFiltered = await xray.step(
      runId,
      XRStepType.FILTER,
      'filter-by-price',
      async (items: Product[]) => {
        // Real filtering logic - works as-is!
        return items.filter(p => {
          if (filters.minPrice && p.price < filters.minPrice) return false;
          if (filters.maxPrice && p.price > filters.maxPrice) return false;
          return true;
        });
      },
      products,
      { minPrice: filters.minPrice, maxPrice: filters.maxPrice }
    );
    console.log(`✅ Price filter: ${priceFiltered.length}/${products.length} products`);

    // Step 2: Filter by category
    const categoryFiltered = await xray.step(
      runId,
      XRStepType.FILTER,
      'filter-by-category',
      async (items: Product[]) => {
        // Real filtering logic
        if (!filters.categories || filters.categories.length === 0) {
          return items;
        }
        return items.filter(p => filters.categories!.includes(p.category));
      },
      priceFiltered,
      { categories: filters.categories }
    );
    console.log(`✅ Category filter: ${categoryFiltered.length}/${priceFiltered.length} products`);

    // Step 3: Filter by rating
    const ratingFiltered = await xray.step(
      runId,
      XRStepType.FILTER,
      'filter-by-rating',
      async (items: Product[]) => {
        // Real filtering logic
        if (!filters.minRating) return items;
        return items.filter(p => p.rating >= filters.minRating!);
      },
      categoryFiltered,
      { minRating: filters.minRating }
    );
    console.log(`✅ Rating filter: ${ratingFiltered.length}/${categoryFiltered.length} products`);

    // Step 4: Filter by stock availability
    const stockFiltered = await xray.step(
      runId,
      XRStepType.FILTER,
      'filter-by-stock',
      async (items: Product[]) => {
        // Real filtering logic
        if (!filters.inStockOnly) return items;
        return items.filter(p => p.inStock);
      },
      ratingFiltered,
      { inStockOnly: filters.inStockOnly }
    );
    console.log(`✅ Stock filter: ${stockFiltered.length}/${ratingFiltered.length} products`);

    // Step 5: Rank by relevance (price + rating)
    const ranked = await xray.step(
      runId,
      XRStepType.RANK,
      'rank-by-relevance',
      async (items: Product[]) => {
        // Real ranking logic
        return items
          .map(item => ({
            ...item,
            relevanceScore: (item.rating * 0.7) + ((1000 - item.price) / 1000 * 0.3),
          }))
          .sort((a, b) => b.relevanceScore - a.relevanceScore);
      },
      stockFiltered
    );
    console.log(`✅ Ranking: Top ${Math.min(10, ranked.length)} products`);

    // End tracking
    await xray.endRun(runId, ranked);
    await xray.flush(); // Ensure all events are sent

    console.log(`\n📊 Pipeline Summary:`);
    console.log(`   Input: ${products.length} products`);
    console.log(`   Output: ${ranked.length} products`);
    console.log(`   Elimination Ratio: ${((1 - ranked.length / products.length) * 100).toFixed(1)}%`);
    console.log(`\n🏆 Top 5 Results:`);
    ranked.slice(0, 5).forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name} - $${p.price} (Rating: ${p.rating}, Score: ${(p as any).relevanceScore.toFixed(3)})`);
    });

    console.log(`\n✅ Check dashboard at http://localhost:3000/runs to see detailed decision tracking!`);
    console.log(`   Run ID: ${runId}\n`);

    return ranked;
  } catch (error) {
    await xray.endRun(runId, null, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Real-world test data
 */
function getTestProducts(): Product[] {
  return [
    { id: 'p1', name: 'Wireless Headphones', price: 99.99, category: 'Electronics', rating: 4.5, inStock: true, tags: ['audio', 'wireless'] },
    { id: 'p2', name: 'Laptop Stand', price: 29.99, category: 'Accessories', rating: 4.2, inStock: true, tags: ['office', 'ergonomic'] },
    { id: 'p3', name: 'Mechanical Keyboard', price: 149.99, category: 'Electronics', rating: 4.8, inStock: false, tags: ['gaming', 'keyboard'] },
    { id: 'p4', name: 'USB-C Cable', price: 12.99, category: 'Accessories', rating: 4.0, inStock: true, tags: ['cable', 'charging'] },
    { id: 'p5', name: 'Monitor 27"', price: 299.99, category: 'Electronics', rating: 4.6, inStock: true, tags: ['display', 'office'] },
    { id: 'p6', name: 'Mouse Pad', price: 9.99, category: 'Accessories', rating: 3.8, inStock: true, tags: ['accessory', 'desk'] },
    { id: 'p7', name: 'Webcam HD', price: 79.99, category: 'Electronics', rating: 4.3, inStock: true, tags: ['video', 'office'] },
    { id: 'p8', name: 'Desk Lamp', price: 39.99, category: 'Furniture', rating: 4.1, inStock: true, tags: ['lighting', 'office'] },
    { id: 'p9', name: 'Standing Desk', price: 499.99, category: 'Furniture', rating: 4.7, inStock: false, tags: ['ergonomic', 'office'] },
    { id: 'p10', name: 'Cable Organizer', price: 14.99, category: 'Accessories', rating: 4.0, inStock: true, tags: ['organization', 'cable'] },
    { id: 'p11', name: 'Gaming Mouse', price: 69.99, category: 'Electronics', rating: 4.5, inStock: true, tags: ['gaming', 'mouse'] },
    { id: 'p12', name: 'Monitor Stand', price: 49.99, category: 'Accessories', rating: 4.2, inStock: true, tags: ['stand', 'display'] },
    { id: 'p13', name: 'USB Hub', price: 24.99, category: 'Accessories', rating: 3.9, inStock: true, tags: ['hub', 'usb'] },
    { id: 'p14', name: 'Laptop Sleeve', price: 34.99, category: 'Accessories', rating: 4.1, inStock: true, tags: ['protection', 'laptop'] },
    { id: 'p15', name: 'Desk Mat', price: 19.99, category: 'Accessories', rating: 4.0, inStock: true, tags: ['desk', 'mat'] },
  ];
}

/**
 * Run the real-world test
 */
async function main() {
  console.log('🚀 X-Ray SDK Real-World Test');
  console.log('============================\n');

  const products = getTestProducts();

  // Test Case 1: Basic filtering
  console.log('📦 Test Case 1: Basic Product Filtering');
  console.log('----------------------------------------');
  await productSearchPipeline(products, {
    minPrice: 20,
    maxPrice: 150,
    categories: ['Electronics', 'Accessories'],
    minRating: 4.0,
    inStockOnly: true,
  });

  // Wait a bit before next test
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test Case 2: Strict filtering (high elimination)
  console.log('\n📦 Test Case 2: Strict Filtering (High Elimination)');
  console.log('---------------------------------------------------');
  await productSearchPipeline(products, {
    minPrice: 50,
    maxPrice: 100,
    categories: ['Electronics'],
    minRating: 4.5,
    inStockOnly: true,
  });

  console.log('\n✅ All tests completed!');
  console.log('📊 View results in dashboard: http://localhost:3000/runs\n');
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('✅ Test pipeline completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test pipeline failed:', error);
      process.exit(1);
    });
}

export { productSearchPipeline, getTestProducts };

