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

const now = Date.now();
const DAY = 86400000;

export const mockRestaurants: Restaurant[] = [
  {
    id: "1",
    name: "Ember & Oak",
    city: "New York, NY",
    imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop",
    foodSummary: "Wood-fired steaks and seasonal vegetables with bold, smoky flavors. House-made sauces elevate every plate.",
    atmosphereSummary: "Dimly lit with exposed brick and flickering candles. Intimate booths perfect for date night.",
    openedDate: new Date(now - 2 * DAY).toISOString(),
    cuisine: "American Steakhouse",
    priceRange: "$$$",
  },
  {
    id: "2",
    name: "Sakura Nights",
    city: "Los Angeles, CA",
    imageUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop",
    foodSummary: "Omakase-style sushi with fish flown in daily from Tokyo. Delicate nigiri and creative fusion rolls.",
    atmosphereSummary: "Minimalist zen garden aesthetic with cherry blossom accents. Soft jazz and low lighting.",
    openedDate: new Date(now - 1 * DAY).toISOString(),
    cuisine: "Japanese",
    priceRange: "$$$$",
  },
  {
    id: "3",
    name: "The Copper Pot",
    city: "Chicago, IL",
    imageUrl: "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=600&h=400&fit=crop",
    foodSummary: "Hearty French bistro fare — rich cassoulets, crispy duck confit, and decadent crème brûlée.",
    atmosphereSummary: "Warm copper fixtures and vintage French posters. Feels like a Parisian neighborhood café.",
    openedDate: new Date(now - 3 * DAY).toISOString(),
    cuisine: "French Bistro",
    priceRange: "$$$",
  },
  {
    id: "4",
    name: "Verde Cocina",
    city: "Austin, TX",
    imageUrl: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop",
    foodSummary: "Farm-to-table Mexican cuisine with handmade tortillas and complex mole sauces. Excellent mezcal selection.",
    atmosphereSummary: "Lush indoor plants and terracotta tiles. Open-air patio with string lights and live acoustic music.",
    openedDate: new Date(now - 1 * DAY).toISOString(),
    cuisine: "Mexican",
    priceRange: "$$",
  },
  {
    id: "5",
    name: "Naan & Beyond",
    city: "San Francisco, CA",
    imageUrl: "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&h=400&fit=crop",
    foodSummary: "Modern Indian with tandoori specialties and inventive street food bites. Spice levels customizable.",
    atmosphereSummary: "Vibrant colors meet sleek modern design. Communal tables encourage lively conversation.",
    openedDate: new Date(now - 5 * DAY).toISOString(),
    cuisine: "Indian",
    priceRange: "$$",
  },
  {
    id: "6",
    name: "Driftwood",
    city: "Miami, FL",
    imageUrl: "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&h=400&fit=crop",
    foodSummary: "Coastal seafood with Caribbean influences. Ceviche flights and whole grilled snapper are standouts.",
    atmosphereSummary: "Beachside vibes with reclaimed wood and ocean views. Sunset cocktails on the rooftop deck.",
    openedDate: new Date(now - 2 * DAY).toISOString(),
    cuisine: "Seafood",
    priceRange: "$$$",
  },
  {
    id: "7",
    name: "Smoke Signal",
    city: "Denver, CO",
    imageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=400&fit=crop",
    foodSummary: "Low-and-slow BBQ with house-smoked brisket, ribs, and inventive sides like jalapeño cornbread.",
    atmosphereSummary: "Rustic lodge feel with picnic tables and a massive stone fireplace. Casual and welcoming.",
    openedDate: new Date(now - 4 * DAY).toISOString(),
    cuisine: "BBQ",
    priceRange: "$$",
  },
  {
    id: "8",
    name: "Basil & Bloom",
    city: "Portland, OR",
    imageUrl: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&h=400&fit=crop",
    foodSummary: "Plant-forward cuisine that converts even committed carnivores. Mushroom 'steak' is legendary.",
    atmosphereSummary: "Greenhouse-inspired with hanging plants everywhere. Natural light floods the airy space.",
    openedDate: new Date(now - 1 * DAY).toISOString(),
    cuisine: "Vegan",
    priceRange: "$$",
  },
  {
    id: "9",
    name: "Atlas Kitchen",
    city: "Seattle, WA",
    imageUrl: "https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=600&h=400&fit=crop",
    foodSummary: "Global fusion rotating menu — Korean tacos one week, Ethiopian injera bowls the next.",
    atmosphereSummary: "Industrial chic with rotating art installations. World music sets the globe-trotting mood.",
    openedDate: new Date(now - 6 * DAY).toISOString(),
    cuisine: "Global Fusion",
    priceRange: "$$",
  },
  {
    id: "10",
    name: "Honeycomb",
    city: "Boston, MA",
    imageUrl: "https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?w=600&h=400&fit=crop",
    foodSummary: "New England classics reimagined — lobster rolls with truffle aioli, clam chowder with saffron.",
    atmosphereSummary: "Honey-toned wood and brass accents. Cozy and refined with a crackling fireplace in winter.",
    openedDate: new Date(now - 3 * DAY).toISOString(),
    cuisine: "New American",
    priceRange: "$$$",
  },
  {
    id: "11",
    name: "Fuego Lento",
    city: "New York, NY",
    imageUrl: "https://images.unsplash.com/photo-1600891964092-4316c288032e?w=600&h=400&fit=crop",
    foodSummary: "Argentine asado with chimichurri, empanadas, and provoleta. Wine list heavy on Malbec.",
    atmosphereSummary: "Open grill dominates the room. Leather seating and tango music transport you to Buenos Aires.",
    openedDate: new Date(now - 7 * DAY).toISOString(),
    cuisine: "Argentine",
    priceRange: "$$$",
  },
  {
    id: "12",
    name: "Lumen",
    city: "Los Angeles, CA",
    imageUrl: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600&h=400&fit=crop",
    foodSummary: "Tasting menu with molecular gastronomy touches. Each course tells a story through flavor.",
    atmosphereSummary: "Futuristic white-on-white interior with dramatic lighting shifts between courses.",
    openedDate: new Date(now - 2 * DAY).toISOString(),
    cuisine: "Fine Dining",
    priceRange: "$$$$",
  },
];
