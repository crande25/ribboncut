import { useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useLocalStorage } from "./useLocalStorage";

export function useDeviceId() {
  const [deviceId, setDeviceId] = useLocalStorage<string>("device_id", "");

  useEffect(() => {
    if (!deviceId) {
      setDeviceId(uuidv4());
    }
  }, [deviceId, setDeviceId]);

  return deviceId;
}
