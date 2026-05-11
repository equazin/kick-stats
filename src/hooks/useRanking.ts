import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcularPuntos, FONDO } from "@/lib/scoring";

export interface RankingRow {
  player_id: string;
  nombre: string;
  apodo: string | null;
  foto_url: string | null;
  elo: number;
  partidos_jugados: number;
  partidos_ganados: number;
  efectividad: number;
  goles: number;
  asistencias: number;
  mvp_count: number;
  gol_fecha_count: number;
  promedio_calificacion: number | null;
  promedio_rendimiento: number | null;
  bonus_points: number;
  multas_pendientes: number;
  puntos: number;
}

export type RankingHistorySource = "start" | "historical" | "match" | "bonus";

export interface RankingHistoryPoint {
  id: string;
  fecha: string | null;
  source: RankingHistorySource;
  note: string;
  partidos_jugados: number;
  partidos_ganados: number;
  goles: number;
  asistencias: number;
  mvp_count: number;
  gol_fecha_count: number;
  bonus_points: number;
  puntos: number;
  partidos_jugados_delta: number;
  partidos_ganados_delta: number;
  goles_delta: number;
  asistencias_delta: number;
  mvp_count_delta: number;
  gol_fecha_count_delta: number;
  bonus_points_delta: number;
  puntos_delta: number;
}

export interface RankingPlayerHistory {
  player_id: string;
  timeline: RankingHistoryPoint[];
  latest: RankingHistoryPoint;
}

export interface RankingDataset {
  rows: RankingRow[];
  histories: RankingPlayerHistory[];
}

interface RankingPlayerSource {
  id: string;
  nombre: string;
  apodo: string | null;
  foto_url: string | null;
  elo: number;
  activo: boolean;
  tipo?: string;
}

interface RankingMatchSource {
  id: string;
  fecha: string;
  estado: string;
  equipo_a_score: number;
  equipo_b_score: number;
  mvp_player_id: string | null;
  gol_de_la_fecha_player_id: string | null;
  is_friendly?: boolean | null;
}

interface RankingMatchPlayerSource {
  player_id: string;
  match_id: string;
  equipo: "A" | "B";
  goles: number;
  asistencias: number;
  calificacion: number | null;
  presente: boolean;
}

interface RankingFineSource {
  player_id: string;
  monto: number;
  pagada: boolean;
}

interface RankingBonusSource {
  id: string;
  player_id: string;
  puntos: number;
  fecha: string;
  motivo?: string | null;
}

interface RankingPanelWinSource {
  player_id: string;
  wins_historicas: number;
}

interface RankingHistoricalSource {
  player_id: string;
  pj: number;
  pg: number;
  mvp: number;
  gf: number;
}

interface RankingDatasetInput {
  players: RankingPlayerSource[];
  matches: RankingMatchSource[];
  matchPlayers: RankingMatchPlayerSource[];
  fines: RankingFineSource[];
  bonuses: RankingBonusSource[];
  panelWins: RankingPanelWinSource[];
  historicalStats: RankingHistoricalSource[];
}

interface RankingAccumulator extends RankingRow {
  wins_dynamic: number;
  ratings_total: number;
  ratings_count: number;
}

interface PendingHistoryEvent {
  id: string;
  fecha: string;
  source: "match" | "bonus";
  note: string;
  partidos_jugados_delta: number;
  partidos_ganados_delta: number;
  goles_delta: number;
  asistencias_delta: number;
  mvp_count_delta: number;
  gol_fecha_count_delta: number;
  bonus_points_delta: number;
  puntos_delta: number;
}

interface HistoryStateSnapshot {
  partidos_jugados: number;
  partidos_ganados: number;
  goles: number;
  asistencias: number;
  mvp_count: number;
  gol_fecha_count: number;
  bonus_points: number;
  puntos: number;
}

function calcularPromedioRendimiento(input: {
  partidos: number;
  ganados: number;
  goles: number;
  asistencias: number;
  mvp: number;
  golFecha: number;
}): number | null {
  if (input.partidos <= 0) return null;

  const winRate = input.ganados / input.partidos;
  const golesPorPartido = input.goles / input.partidos;
  const asistPorPartido = input.asistencias / input.partidos;
  const mvpPorPartido = input.mvp / input.partidos;
  const golFechaPorPartido = input.golFecha / input.partidos;

  const score10 =
    winRate * 4 +
    (Math.min(golesPorPartido, 2) / 2) * 1.5 +
    (Math.min(asistPorPartido, 2) / 2) * 1 +
    (Math.min(mvpPorPartido, 0.5) / 0.5) * 2 +
    (Math.min(golFechaPorPartido, 0.5) / 0.5) * 1.5;

  return Number(score10.toFixed(1));
}

function buildHistoryPoint(
  id: string,
  source: RankingHistorySource,
  note: string,
  fecha: string | null,
  state: HistoryStateSnapshot,
  deltas: Omit<RankingHistoryPoint, "id" | "fecha" | "source" | "note" | "partidos_jugados" | "partidos_ganados" | "goles" | "asistencias" | "mvp_count" | "gol_fecha_count" | "bonus_points" | "puntos">,
): RankingHistoryPoint {
  return {
    id,
    fecha,
    source,
    note,
    partidos_jugados: state.partidos_jugados,
    partidos_ganados: state.partidos_ganados,
    goles: state.goles,
    asistencias: state.asistencias,
    mvp_count: state.mvp_count,
    gol_fecha_count: state.gol_fecha_count,
    bonus_points: state.bonus_points,
    puntos: state.puntos,
    ...deltas,
  };
}

function sortHistoryEvents(a: PendingHistoryEvent, b: PendingHistoryEvent) {
  const timeA = new Date(a.fecha).getTime();
  const timeB = new Date(b.fecha).getTime();
  if (timeA !== timeB) return timeA - timeB;
  if (a.source === b.source) return a.id.localeCompare(b.id);
  return a.source === "match" ? -1 : 1;
}

export function buildRankingDataset({
  players,
  matches,
  matchPlayers,
  fines,
  bonuses,
  panelWins,
  historicalStats,
}: RankingDatasetInput): RankingDataset {
  const bonusByPlayer = new Map<string, number>();
  const bonusesByPlayer = new Map<string, RankingBonusSource[]>();
  for (const bonus of bonuses) {
    bonusByPlayer.set(bonus.player_id, (bonusByPlayer.get(bonus.player_id) ?? 0) + Number(bonus.puntos));
    const list = bonusesByPlayer.get(bonus.player_id) ?? [];
    list.push(bonus);
    bonusesByPlayer.set(bonus.player_id, list);
  }

  const panelWinsByPlayer = new Map<string, number>();
  for (const pw of panelWins) {
    panelWinsByPlayer.set(pw.player_id, Number(pw.wins_historicas));
  }

  const historicalByPlayer = new Map<string, { pj: number; pg: number; mvp: number; gf: number }>();
  for (const h of historicalStats) {
    historicalByPlayer.set(h.player_id, {
      pj: Number(h.pj),
      pg: Number(h.pg),
      mvp: Number(h.mvp),
      gf: Number(h.gf),
    });
  }

  const closedMatches = matches
    .filter((match) => match.estado === "cerrado" && !match.is_friendly)
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  const closedMatchIds = new Set(closedMatches.map((match) => match.id));
  const closedMatchesById = new Map(closedMatches.map((match) => [match.id, match]));
  const matchPlayersByMatch = new Map<string, RankingMatchPlayerSource[]>();
  for (const mp of matchPlayers) {
    if (!closedMatchIds.has(mp.match_id)) continue;
    const list = matchPlayersByMatch.get(mp.match_id) ?? [];
    list.push(mp);
    matchPlayersByMatch.set(mp.match_id, list);
  }

  const rows = new Map<string, RankingAccumulator>();
  for (const player of players) {
    if (!player.activo) continue;
    if (player.tipo === "invitado") continue;
    rows.set(player.id, {
      player_id: player.id,
      nombre: player.nombre,
      apodo: player.apodo,
      foto_url: player.foto_url,
      elo: Number(player.elo || 1000),
      partidos_jugados: 0,
      partidos_ganados: 0,
      efectividad: 0,
      goles: 0,
      asistencias: 0,
      mvp_count: 0,
      gol_fecha_count: 0,
      promedio_calificacion: null,
      promedio_rendimiento: null,
      bonus_points: 0,
      multas_pendientes: 0,
      puntos: 0,
      wins_dynamic: 0,
      ratings_total: 0,
      ratings_count: 0,
    });
  }

  for (const mp of matchPlayers) {
    if (!mp.presente) continue;
    const row = rows.get(mp.player_id);
    const match = closedMatchesById.get(mp.match_id);
    if (!row || !match) continue;

    row.partidos_jugados += 1;
    row.goles += Number(mp.goles || 0);
    row.asistencias += Number(mp.asistencias || 0);
    if (typeof mp.calificacion === "number") {
      row.ratings_total += Number(mp.calificacion);
      row.ratings_count += 1;
    }

    const winA = match.equipo_a_score > match.equipo_b_score;
    const winB = match.equipo_b_score > match.equipo_a_score;
    if ((mp.equipo === "A" && winA) || (mp.equipo === "B" && winB)) {
      row.wins_dynamic += 1;
    }
  }

  for (const match of closedMatches) {
    if (match.mvp_player_id && rows.has(match.mvp_player_id)) {
      rows.get(match.mvp_player_id)!.mvp_count += 1;
    }
    if (match.gol_de_la_fecha_player_id && rows.has(match.gol_de_la_fecha_player_id)) {
      rows.get(match.gol_de_la_fecha_player_id)!.gol_fecha_count += 1;
    }
  }

  for (const fine of fines) {
    if (fine.pagada) continue;
    const row = rows.get(fine.player_id);
    if (!row) continue;
    row.multas_pendientes += Number(fine.monto || 0);
  }

  const rankingRows = [...rows.values()].map((row) => {
    row.promedio_calificacion =
      row.ratings_count > 0 ? Number((row.ratings_total / row.ratings_count).toFixed(2)) : null;

    const hist = historicalByPlayer.get(row.player_id);
    const panelWinsCount = panelWinsByPlayer.get(row.player_id);
    const bonus = bonusByPlayer.get(row.player_id) ?? 0;

    const totalPJ = row.partidos_jugados + (hist?.pj ?? 0);
    const totalMVP = row.mvp_count + (hist?.mvp ?? 0);
    const totalGF = row.gol_fecha_count + (hist?.gf ?? 0);

    const histWins = panelWinsCount ?? hist?.pg ?? 0;
    const totalWins = histWins + row.wins_dynamic;

    const efectividad = totalPJ > 0 ? Number(((totalWins / totalPJ) * 100).toFixed(1)) : 0;
    const promedioRendimiento = calcularPromedioRendimiento({
      partidos: totalPJ,
      ganados: totalWins,
      goles: row.goles,
      asistencias: row.asistencias,
      mvp: totalMVP,
      golFecha: totalGF,
    });

    row.partidos_jugados = totalPJ;
    row.partidos_ganados = totalWins;
    row.mvp_count = totalMVP;
    row.gol_fecha_count = totalGF;
    row.efectividad = efectividad;
    row.promedio_rendimiento = promedioRendimiento;
    row.bonus_points = bonus;
    row.puntos = calcularPuntos({
      partidos_jugados: totalPJ,
      partidos_ganados: totalWins,
      mvp_count: totalMVP,
      gol_fecha_count: totalGF,
      bonus_points: bonus,
    });

    return {
      player_id: row.player_id,
      nombre: row.nombre,
      apodo: row.apodo,
      foto_url: row.foto_url,
      elo: row.elo,
      partidos_jugados: row.partidos_jugados,
      partidos_ganados: row.partidos_ganados,
      efectividad: row.efectividad,
      goles: row.goles,
      asistencias: row.asistencias,
      mvp_count: row.mvp_count,
      gol_fecha_count: row.gol_fecha_count,
      promedio_calificacion: row.promedio_calificacion,
      promedio_rendimiento: row.promedio_rendimiento,
      bonus_points: row.bonus_points,
      multas_pendientes: row.multas_pendientes,
      puntos: row.puntos,
    } as RankingRow;
  });

  rankingRows.sort((a, b) => b.puntos - a.puntos || b.mvp_count - a.mvp_count || b.partidos_jugados - a.partidos_jugados);

  const pendingEventsByPlayer = new Map<string, PendingHistoryEvent[]>();
  for (const row of rankingRows) {
    pendingEventsByPlayer.set(row.player_id, []);
  }

  for (const match of closedMatches) {
    const participants = matchPlayersByMatch.get(match.id) ?? [];
    const winA = match.equipo_a_score > match.equipo_b_score;
    const winB = match.equipo_b_score > match.equipo_a_score;

    for (const participant of participants) {
      if (!participant.presente) continue;
      if (!pendingEventsByPlayer.has(participant.player_id)) continue;

      const deltaWins = (participant.equipo === "A" && winA) || (participant.equipo === "B" && winB) ? 1 : 0;
      const deltaMvp = match.mvp_player_id === participant.player_id ? 1 : 0;
      const deltaGolFecha = match.gol_de_la_fecha_player_id === participant.player_id ? 1 : 0;
      const deltaGoles = Number(participant.goles || 0);
      const deltaAsistencias = Number(participant.asistencias || 0);
      const deltaPuntos = calcularPuntos({
        partidos_jugados: 1,
        partidos_ganados: deltaWins,
        mvp_count: deltaMvp,
        gol_fecha_count: deltaGolFecha,
      });

      pendingEventsByPlayer.get(participant.player_id)!.push({
        id: `match-${match.id}`,
        fecha: match.fecha,
        source: "match",
        note: deltaWins ? "Partido ganado" : "Partido cerrado",
        partidos_jugados_delta: 1,
        partidos_ganados_delta: deltaWins,
        goles_delta: deltaGoles,
        asistencias_delta: deltaAsistencias,
        mvp_count_delta: deltaMvp,
        gol_fecha_count_delta: deltaGolFecha,
        bonus_points_delta: 0,
        puntos_delta: deltaPuntos,
      });
    }
  }

  for (const [playerId, playerBonuses] of bonusesByPlayer.entries()) {
    if (!pendingEventsByPlayer.has(playerId)) continue;
    for (const bonus of playerBonuses) {
      const deltaPuntos = Number(bonus.puntos);
      pendingEventsByPlayer.get(playerId)!.push({
        id: `bonus-${bonus.id}`,
        fecha: bonus.fecha,
        source: "bonus",
        note: bonus.motivo?.trim() || "Bonus manual",
        partidos_jugados_delta: 0,
        partidos_ganados_delta: 0,
        goles_delta: 0,
        asistencias_delta: 0,
        mvp_count_delta: 0,
        gol_fecha_count_delta: 0,
        bonus_points_delta: deltaPuntos,
        puntos_delta: deltaPuntos,
      });
    }
  }

  const histories = rankingRows.map((row) => {
    const hist = historicalByPlayer.get(row.player_id);
    const panelWinsCount = panelWinsByPlayer.get(row.player_id);
    const baseState: HistoryStateSnapshot = {
      partidos_jugados: hist?.pj ?? 0,
      partidos_ganados: panelWinsCount ?? hist?.pg ?? 0,
      goles: 0,
      asistencias: 0,
      mvp_count: hist?.mvp ?? 0,
      gol_fecha_count: hist?.gf ?? 0,
      bonus_points: 0,
      puntos: 0,
    };
    baseState.puntos = calcularPuntos({
      partidos_jugados: baseState.partidos_jugados,
      partidos_ganados: baseState.partidos_ganados,
      mvp_count: baseState.mvp_count,
      gol_fecha_count: baseState.gol_fecha_count,
      bonus_points: baseState.bonus_points,
    });

    const hasHistoricalBase =
      baseState.partidos_jugados > 0 ||
      baseState.partidos_ganados > 0 ||
      baseState.mvp_count > 0 ||
      baseState.gol_fecha_count > 0;

    const timeline: RankingHistoryPoint[] = [
      buildHistoryPoint(
        `${row.player_id}-base`,
        hasHistoricalBase ? "historical" : "start",
        hasHistoricalBase ? "Base historica" : "Inicio del seguimiento digital",
        null,
        baseState,
        {
          partidos_jugados_delta: 0,
          partidos_ganados_delta: 0,
          goles_delta: 0,
          asistencias_delta: 0,
          mvp_count_delta: 0,
          gol_fecha_count_delta: 0,
          bonus_points_delta: 0,
          puntos_delta: 0,
        },
      ),
    ];

    const state: HistoryStateSnapshot = { ...baseState };
    const events = [...(pendingEventsByPlayer.get(row.player_id) ?? [])].sort(sortHistoryEvents);
    for (const event of events) {
      state.partidos_jugados += event.partidos_jugados_delta;
      state.partidos_ganados += event.partidos_ganados_delta;
      state.goles += event.goles_delta;
      state.asistencias += event.asistencias_delta;
      state.mvp_count += event.mvp_count_delta;
      state.gol_fecha_count += event.gol_fecha_count_delta;
      state.bonus_points += event.bonus_points_delta;
      state.puntos = calcularPuntos({
        partidos_jugados: state.partidos_jugados,
        partidos_ganados: state.partidos_ganados,
        mvp_count: state.mvp_count,
        gol_fecha_count: state.gol_fecha_count,
        bonus_points: state.bonus_points,
      });

      timeline.push(
        buildHistoryPoint(
          `${row.player_id}-${event.id}`,
          event.source,
          event.note,
          event.fecha,
          state,
          {
            partidos_jugados_delta: event.partidos_jugados_delta,
            partidos_ganados_delta: event.partidos_ganados_delta,
            goles_delta: event.goles_delta,
            asistencias_delta: event.asistencias_delta,
            mvp_count_delta: event.mvp_count_delta,
            gol_fecha_count_delta: event.gol_fecha_count_delta,
            bonus_points_delta: event.bonus_points_delta,
            puntos_delta: event.puntos_delta,
          },
        ),
      );
    }

    return {
      player_id: row.player_id,
      timeline,
      latest: timeline[timeline.length - 1],
    } as RankingPlayerHistory;
  });

  return {
    rows: rankingRows,
    histories,
  };
}

const QUERY_TIMEOUT_MS = 10000;

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout al cargar ${label}`)), QUERY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeoutPromise]);
};

const emptyQueryResult = <T,>() => ({ data: [] as T[], error: null });

const fromUntypedTable = (table: string) => (supabase as any).from(table) as {
  select: (columns: string) => PromiseLike<{
    data: unknown[] | null;
    error: Error | null;
  }>;
};

async function fetchRankingDataset(): Promise<RankingDataset> {
  const [playersRes, matchesRes, matchPlayersRes, bonusesRes, panelWinsRes, historicalRes] = await Promise.all([
    withTimeout(Promise.resolve(supabase.from("players").select("id, nombre, apodo, foto_url, elo, activo, tipo")), "jugadores"),
    withTimeout(
      Promise.resolve(
        supabase
          .from("matches")
          .select("id, fecha, estado, equipo_a_score, equipo_b_score, mvp_player_id, gol_de_la_fecha_player_id, is_friendly"),
      ),
      "partidos",
    ),
    withTimeout(
      Promise.resolve(supabase.from("match_players").select("player_id, match_id, equipo, goles, asistencias, calificacion, presente")),
      "participaciones",
    ),
    withTimeout(Promise.resolve(supabase.from("player_bonuses").select("id, player_id, puntos, fecha, motivo")), "bonuses").catch(
      () => emptyQueryResult<RankingBonusSource>(),
    ),
    withTimeout(Promise.resolve(supabase.from("player_panel_wins").select("player_id, wins_historicas")), "panel_wins").catch(
      () => emptyQueryResult<RankingPanelWinSource>(),
    ),
    withTimeout(Promise.resolve(supabase.from("player_historical_stats").select("player_id, pj, pg, mvp, gf")), "historial").catch(
      () => emptyQueryResult<RankingHistoricalSource>(),
    ),
  ]);

  const finesRes = await withTimeout(Promise.resolve(supabase.from("fines").select("player_id, monto, pagada")), "multas").catch(
    () => emptyQueryResult<RankingFineSource>(),
  );

  if (playersRes.error) throw playersRes.error;
  if (matchesRes.error) throw matchesRes.error;
  if (matchPlayersRes.error) throw matchPlayersRes.error;

  return buildRankingDataset({
    players: (playersRes.data ?? []) as RankingPlayerSource[],
    matches: (matchesRes.data ?? []) as RankingMatchSource[],
    matchPlayers: (matchPlayersRes.data ?? []) as RankingMatchPlayerSource[],
    fines: (finesRes.data ?? []) as RankingFineSource[],
    bonuses: (bonusesRes.data ?? []) as RankingBonusSource[],
    panelWins: (panelWinsRes.data ?? []) as RankingPanelWinSource[],
    historicalStats: (historicalRes.data ?? []) as RankingHistoricalSource[],
  });
}

export const useRanking = () =>
  useQuery({
    queryKey: ["rankings"],
    networkMode: "always",
    retry: 1,
    queryFn: fetchRankingDataset,
    select: (data) => data.rows,
  });

export const useRankingDataset = () =>
  useQuery({
    queryKey: ["rankings"],
    networkMode: "always",
    retry: 1,
    queryFn: fetchRankingDataset,
  });

export const useFondo = () =>
  useQuery({
    queryKey: ["fondo"],
    queryFn: async () => {
      const [contribsRes, finesRes, movementsRes] = await Promise.all([
        supabase
          .from("contributions")
          .select("monto, pagado, match:matches(fecha)"),
        supabase.from("fines").select("monto, pagada"),
        Promise.resolve(fromUntypedTable("fund_movements").select("tipo, monto"))
          .catch(() => ({ data: [], error: null })),
      ]);
      if (contribsRes.error) throw contribsRes.error;
      if (finesRes.error) throw finesRes.error;

      const allContribs = (contribsRes.data ?? []) as Array<{
        monto: number;
        pagado: boolean;
        match: { fecha: string } | null;
      }>;
      const fines = (finesRes.data ?? []) as { monto: number; pagada: boolean }[];
      const movements = (movementsRes.data ?? []) as Array<{
        tipo: "ingreso" | "egreso";
        monto: number;
      }>;

      const contribs = allContribs.filter((c) => {
        const fecha = c.match?.fecha;
        return fecha != null && fecha >= FONDO.FECHA_INICIO;
      });

      const aportesTotal = contribs.reduce((s, r) => s + Number(r.monto), 0);
      const aporteCobrado = contribs.filter((r) => r.pagado).reduce((s, r) => s + Number(r.monto), 0);
      const multasTotal = fines.reduce((s, r) => s + Number(r.monto), 0);
      const multasCobradas = fines.filter((r) => r.pagada).reduce((s, r) => s + Number(r.monto), 0);
      const manualIngresos = movements
        .filter((r) => r.tipo === "ingreso")
        .reduce((s, r) => s + Number(r.monto), 0);
      const manualEgresos = movements
        .filter((r) => r.tipo === "egreso")
        .reduce((s, r) => s + Number(r.monto), 0);
      const manualSaldo = manualIngresos - manualEgresos;

      const total = FONDO.BASE + aportesTotal;
      const cobrado = FONDO.BASE + aporteCobrado;

      return {
        total,
        cobrado,
        pendiente: aportesTotal - aporteCobrado,
        count: contribs.length,
        multasTotal,
        multasCobradas,
        multasPendientes: multasTotal - multasCobradas,
        caja: FONDO.BASE + aporteCobrado + multasCobradas + manualSaldo,
        base: FONDO.BASE,
        aportesDigitales: aporteCobrado,
        manualIngresos,
        manualEgresos,
        manualSaldo,
      };
    },
  });
