export const VOTING_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface VotingWindowMatch {
  fecha: string;
  estado: string;
  votacion_abre?: string | null;
  votacion_cierra?: string | null;
  is_friendly?: boolean | null;
}

export const getVotingDeadline = (match: Pick<VotingWindowMatch, "fecha" | "votacion_cierra">) => {
  const explicitDeadline = match.votacion_cierra ? new Date(match.votacion_cierra).getTime() : NaN;
  if (!Number.isNaN(explicitDeadline)) return explicitDeadline;
  return new Date(match.fecha).getTime() + VOTING_WINDOW_MS;
};

export const isVotingOpenForMatch = (match: VotingWindowMatch, now = Date.now()) => {
  const openAt = match.votacion_abre ? new Date(match.votacion_abre).getTime() : new Date(match.fecha).getTime();
  const deadline = getVotingDeadline(match);
  if (Number.isNaN(openAt) || Number.isNaN(deadline)) return false;
  return match.estado === "jugado" && !match.is_friendly && now >= openAt && now < deadline;
};

export const isVotingExpiredForMatch = (match: VotingWindowMatch, now = Date.now()) => {
  const deadline = getVotingDeadline(match);
  if (Number.isNaN(deadline)) return false;
  return match.estado === "jugado" && !match.is_friendly && now >= deadline;
};

export const buildVotingWindowPatch = (
  fechaIso: string,
  estado: string,
  now = Date.now()
) => {
  if (estado !== "jugado") return {};

  const matchTime = new Date(fechaIso).getTime();
  const startsAt = Number.isNaN(matchTime) ? now : matchTime;
  const defaultDeadline = startsAt + VOTING_WINDOW_MS;
  const reopenFrom = defaultDeadline <= now ? now : startsAt;

  return {
    votacion_abre: new Date(reopenFrom).toISOString(),
    votacion_cierra: new Date(reopenFrom + VOTING_WINDOW_MS).toISOString(),
  };
};
