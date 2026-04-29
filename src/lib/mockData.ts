export interface Restaurant {
  id: string;
  name: string;
  city: string;
  imageUrl: string;
  foodSummary: string;
  atmosphereSummary: string;
  openedDate: string;
  cuisine: string;
  priceRange: string;
  rating?: number;
  reviewCount?: number;
  address?: string;
  phone?: string;
  url?: string;
  photos?: string[];
}

// Minimal fallback data shown when the live API fails. Kept intentionally
// small — this is a safety net, not a content source.
export const mockRestaurants: Restaurant[] = [
  {
    id: "mock-1",
    name: "Sample Bistro",
    city: "Detroit, MI",
    imageUrl:
      "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&q=80",
    foodSummary: "Modern American • 4.5★",
    atmosphereSummary: "Cozy neighborhood spot with warm lighting",
    openedDate: new Date(Date.now() - 7 * 86400000).toISOString(),
    cuisine: "American",
    priceRange: "$$",
    rating: 4.5,
    reviewCount: 42,
  },
  {
    id: "mock-2",
    name: "Sample Taqueria",
    city: "Ann Arbor, MI",
    imageUrl:
      "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80",
    foodSummary: "Mexican • 4.7★",
    atmosphereSummary: "Lively counter-service spot, great for groups",
    openedDate: new Date(Date.now() - 14 * 86400000).toISOString(),
    cuisine: "Mexican",
    priceRange: "$",
    rating: 4.7,
    reviewCount: 88,
  },
];
