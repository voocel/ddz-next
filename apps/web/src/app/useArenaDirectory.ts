import { useCallback, useEffect, useState } from "react";
import type { RoomDto } from "@ddz/protocol";
import type { ApiClient } from "../net/apiClient";

/** 竞技场直播目录:open/playing 的全 AI 房列表,挂载即拉取;失败静默(板块有手动刷新)。 */
export function useArenaDirectory(api: ApiClient) {
  const [rooms, setRooms] = useState<readonly RoomDto[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await api.listArenaRooms();
      setRooms(response.rooms);
    } catch {
      // 直播列表失败静默：板块里有手动刷新
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rooms, refresh };
}
