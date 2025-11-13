### Initial DB Design

Keep one main table for human-readable signals:

**Initial SQL Code**
create table nfr26_signals (
  id bigserial primary key,
  timestamp timestamptz not null,
  source text,
  signal_name text not null,
  value numeric,
  unit text
);

- ID (unique for each data input)
- timeStamp (for each signal, must be provided in API call)
- source (signal source PDM, Inverter...)
- signal_name (Gen_Amps, Fan_Amps, Cell1...)
- value
- unit (V, A, bool, RPM...)

**WIP Step 2:**
add MAP to find car based on xy value