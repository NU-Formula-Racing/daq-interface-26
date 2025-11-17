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

**auto generate ID:**
ALTER TABLE nfr26_signals
ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

**enable realtime**
ALTER PUBLICATION supabase_realtime ADD TABLE nfr26_signals;


### WIP

- add column for session ID (unique for each day), it will reset each day
, everytime the python parser sends data to the database, it will check most recent id and increment it and all signals
it adds will be based off that id number

- add column for type (Live or SD)

- if no session ID, implies its from SD card

**SQL**
alter table nfr26_signals 
add column session_id integer,
add column signal_type text;

