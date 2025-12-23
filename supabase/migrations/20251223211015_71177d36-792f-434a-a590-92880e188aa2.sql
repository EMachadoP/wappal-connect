-- Adicionar campo display_name opcional na tabela profiles
ALTER TABLE public.profiles 
ADD COLUMN display_name TEXT;