import { RestaurantFeed } from "@/components/RestaurantFeed";
import { useDeviceId } from "@/hooks/useDeviceId";

export default function Index() {
  useDeviceId(); // Ensure device ID is generated on first visit
  return <RestaurantFeed />;
}
