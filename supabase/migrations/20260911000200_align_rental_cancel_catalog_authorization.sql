BEGIN;
SET search_path TO erp, public;

CREATE OR REPLACE FUNCTION erp.command_cancel_rental(command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth AS $$
DECLARE state rental_status;
BEGIN
  SELECT status INTO state FROM rentals WHERE id=command->>'rentalId' AND company_id=(SELECT company_id FROM users WHERE id=auth.uid() AND status='active');
  IF state NOT IN('Draft','Assigned','Reserved') THEN RETURN jsonb_build_object('success',false,'code','CANCELLATION_NOT_ALLOWED','message','Rental cancellation is not allowed.','retryable',false,'refreshRequired',false); END IF;
  RETURN execute_rental_lifecycle_transition(command,'CANCEL_RENTAL',state,'Cancelled','rental.update');
END $$;

COMMIT;
