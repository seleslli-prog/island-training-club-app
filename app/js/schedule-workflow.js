import { addDays, isoDate } from "./data.js";

export function createScheduleWorkflow({ isLive, readLocalWindow, readLiveWindow }) {
  return {
    async loadWindow({ startDate, days = 7, viewer = null, force = false }) {
      const startISO = isoDate(startDate);
      const endISO = isoDate(addDays(startDate, days - 1));
      const source = isLive() ? readLiveWindow : readLocalWindow;
      const result = await source({ startISO, endISO, viewer, force });
      return {
        ...result,
        sessions: [...(result.sessions || [])],
      };
    },
  };
}
