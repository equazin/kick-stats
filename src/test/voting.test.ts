import { describe, expect, it } from "vitest";
import {
  buildVotingWindowPatch,
  isVotingExpiredForMatch,
  isVotingOpenForMatch,
  VOTING_WINDOW_MS,
} from "@/lib/voting";

describe("voting window helpers", () => {
  it("reopens an old played match from now so it does not immediately expire", () => {
    const now = Date.parse("2026-05-19T12:00:00.000Z");
    const patch = buildVotingWindowPatch("2026-05-16T21:00:00.000Z", "jugado", now);

    expect(patch).toEqual({
      votacion_abre: "2026-05-19T12:00:00.000Z",
      votacion_cierra: "2026-05-21T12:00:00.000Z",
    });
    expect(
      isVotingOpenForMatch(
        {
          fecha: "2026-05-16T21:00:00.000Z",
          estado: "jugado",
          ...patch,
        },
        now
      )
    ).toBe(true);
    expect(
      isVotingExpiredForMatch(
        {
          fecha: "2026-05-16T21:00:00.000Z",
          estado: "jugado",
          ...patch,
        },
        now
      )
    ).toBe(false);
  });

  it("keeps the match-based window when the deadline is still in the future", () => {
    const now = Date.parse("2026-05-17T12:00:00.000Z");
    const fechaIso = "2026-05-16T21:00:00.000Z";
    const patch = buildVotingWindowPatch(fechaIso, "jugado", now);

    expect(patch).toEqual({
      votacion_abre: fechaIso,
      votacion_cierra: new Date(Date.parse(fechaIso) + VOTING_WINDOW_MS).toISOString(),
    });
  });

  it("does not add voting dates for non-played statuses", () => {
    expect(buildVotingWindowPatch("2026-05-16T21:00:00.000Z", "cerrado")).toEqual({});
    expect(buildVotingWindowPatch("2026-05-16T21:00:00.000Z", "pendiente")).toEqual({});
  });
});
