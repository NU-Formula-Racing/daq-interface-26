import { supabase } from "./supabaseClient";

// Supabase enforces a server-side max of 1000 rows per request.
// We must paginate in chunks of 1000 to fetch all data.
const PAGE_SIZE = 1000;

/**
 * Paginate a Supabase query to fetch ALL rows, bypassing the default 1000-row limit.
 *
 * @param {function} buildQuery - A function that receives the supabase client and returns
 *   a query builder (everything EXCEPT .range()). Example:
 *     (sb) => sb.from("nfr26_signals").select("*").eq("session_id", 5).order("timestamp")
 * @returns {Promise<Array>} All rows concatenated.
 */
export async function fetchAllRows(buildQuery) {
  let all = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery(supabase).range(
      offset,
      offset + PAGE_SIZE - 1
    );

    if (error) throw error;

    all = all.concat(data ?? []);

    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}
