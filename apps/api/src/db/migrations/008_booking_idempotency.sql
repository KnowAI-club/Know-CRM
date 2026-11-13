-- Public booking replays are matched on request id + a hash of the request body.
ALTER TABLE booking_reservations ADD COLUMN request_hash text NOT NULL DEFAULT '';
