-- Fix handle_new_user function to handle existing profiles
-- This prevents "Database error querying schema" when logging in with manually created users

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- Use ON CONFLICT to avoid duplicate key errors
    INSERT INTO public.profiles (id, email, name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
    )
    ON CONFLICT (id) DO NOTHING; -- Ignore if profile already exists
    
    RETURN NEW;
END;
$$;
