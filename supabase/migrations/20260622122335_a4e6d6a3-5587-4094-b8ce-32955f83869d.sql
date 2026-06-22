ALTER TABLE public.profiles ALTER COLUMN timezone DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN timezone DROP DEFAULT;