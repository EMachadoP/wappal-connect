-- Migration: Reconcile Task Templates Schema & Seed
-- Created: 2026-01-14
-- Purpose: Ensures all columns exist and applies the normalized V3 seed data

-- 1) Ensure schema is complete
DO $$ 
BEGIN
  -- Add match_keywords if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_templates' AND column_name='match_keywords') THEN
    ALTER TABLE task_templates ADD COLUMN match_keywords text[] DEFAULT '{}';
  END IF;

  -- Add match_priority if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_templates' AND column_name='match_priority') THEN
    ALTER TABLE task_templates ADD COLUMN match_priority INT DEFAULT 0;
  END IF;

  -- Add criticality if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_templates' AND column_name='criticality') THEN
    ALTER TABLE task_templates ADD COLUMN criticality text NOT NULL DEFAULT 'non_critical';
  END IF;

  -- Add sla_business_days if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_templates' AND column_name='sla_business_days') THEN
    ALTER TABLE task_templates ADD COLUMN sla_business_days int NOT NULL DEFAULT 2;
  END IF;
END $$;

-- 2) Ensure unique constraint for UPSERT
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_task_templates_key') THEN
        CREATE UNIQUE INDEX uq_task_templates_key ON task_templates (category, title);
    END IF;
END $$;

-- 3) Apply Seed Data (Idempotent V3)
WITH templates AS (
  SELECT *
  FROM (
    VALUES
    -- PORTÕES
    ('gate_motor','Portão veicular travado / não abre ou não fecha', 120, 2, 'critical', 0, ARRAY['PORTAO'],
      ARRAY['travado','não abre','nao abre','não fecha','nao fecha','portao','portão'],
      jsonb_build_array(
        jsonb_build_object('name','Parafusos e buchas (kit)','qty',1,'unit','kit','sku','KIT-PAR','optional',false),
        jsonb_build_object('name','Placa do motor','qty',1,'unit','un','sku','MTR-PLACA','optional',true),
        jsonb_build_object('name','Engrenagem','qty',1,'unit','un','sku','MTR-ENG','optional',true),
        jsonb_build_object('name','Cremalheira (barra)','qty',1,'unit','un','sku','CREM','optional',true),
        jsonb_build_object('name','Fusível','qty',2,'unit','un','sku','FUS','optional',true)
      ),
      10, true
    ),

    ('gate_motor','Portão veicular – falha de acionamento (controle/botoeira)', 60, 1, 'critical', 0, ARRAY['PORTAO'],
      ARRAY['controle','botoeira','falha no acionamento','não aciona','nao aciona','portao','portão'],
      jsonb_build_array(
        jsonb_build_object('name','Botoeira','qty',1,'unit','un','sku','BOTOEIRA','optional',true),
        jsonb_build_object('name','Controle remoto','qty',2,'unit','un','sku','CTRL','optional',true),
        jsonb_build_object('name','Fusível','qty',2,'unit','un','sku','FUS','optional',true),
        jsonb_build_object('name','Parafusos e buchas (kit)','qty',1,'unit','kit','sku','KIT-PAR','optional',false)
      ),
      8, true
    ),

    ('gate_motor','Portão veicular – ajuste percurso / sensores / fim de curso', 120, 1, 'non_critical', 2, ARRAY['PORTAO'],
      ARRAY['percurso','fim de curso','sensor','ajuste','para no meio','não completa','nao completa'],
      jsonb_build_array(
        jsonb_build_object('name','Parafusos e buchas (kit)','qty',1,'unit','kit','sku','KIT-PAR','optional',false),
        jsonb_build_object('name','Fusível','qty',2,'unit','un','sku','FUS','optional',true),
        jsonb_build_object('name','Placa do motor','qty',1,'unit','un','sku','MTR-PLACA','optional',true)
      ),
      6, true
    ),

    ('gate_motor','Portão veicular – trilho/roldanas/desalinhamento', 180, 2, 'critical', 0, ARRAY['PORTAO'],
      ARRAY['desalinhado','trilho','roldana','arrastando','raspando','portao pesado','portão pesado'],
      jsonb_build_array(
        jsonb_build_object('name','Parafusos e buchas (kit)','qty',1,'unit','kit','sku','KIT-PAR','optional',false),
        jsonb_build_object('name','Engrenagem','qty',1,'unit','un','sku','MTR-ENG','optional',true),
        jsonb_build_object('name','Cremalheira (barra)','qty',1,'unit','un','sku','CREM','optional',true)
      ),
      9, true
    ),

    ('gate_motor','Instalação/troca de motor de portão (serviço completo)', 240, 2, 'critical', 0, ARRAY['PORTAO'],
      ARRAY['troca motor','instalar motor','motor novo','substituir motor','motor queimou'],
      jsonb_build_array(
        jsonb_build_object('name','Placa do motor','qty',1,'unit','un','sku','MTR-PLACA','optional',true),
        jsonb_build_object('name','Engrenagem','qty',1,'unit','un','sku','MTR-ENG','optional',true),
        jsonb_build_object('name','Cremalheira (barra)','qty',1,'unit','un','sku','CREM','optional',true),
        jsonb_build_object('name','Parafusos e buchas (kit)','qty',1,'unit','kit','sku','KIT-PAR','optional',false)
      ),
      7, true
    ),

    -- INTERFONE
    ('intercom','Central de interfone fora do ar (sem comunicação geral)', 240, 1, 'critical', 0, ARRAY['INTERFONE'],
      ARRAY['central','interfone','fora do ar','sem comunicacao','sem comunicação','mudo','sem contato'],
      jsonb_build_array(
        jsonb_build_object('name','Placa ramal','qty',1,'unit','un','sku','INT-PL-RAMAL','optional',true),
        jsonb_build_object('name','Placa fonte','qty',1,'unit','un','sku','INT-PL-FONTE','optional',true),
        jsonb_build_object('name','Conectores/terminais','qty',10,'unit','un','sku','TERM','optional',false),
        jsonb_build_object('name','Cabo (interfone/CI)','qty',20,'unit','m','sku','CAB-INT','optional',true)
      ),
      10, true
    ),

    ('intercom','Interfone – ramal/apartamento sem chamada', 60, 1, 'non_critical', 2, ARRAY['INTERFONE'],
      ARRAY['ramal','apartamento','não chama','nao chama','não recebe','nao recebe','sem chamada'],
      jsonb_build_array(
        jsonb_build_object('name','Conectores/terminais','qty',10,'unit','un','sku','TERM','optional',false),
        jsonb_build_object('name','Cabo (interfone/CI)','qty',20,'unit','m','sku','CAB-INT','optional',true)
      ),
      6, true
    ),

    ('intercom','Reinstalação da central após assistência técnica', 120, 1, 'critical', 0, ARRAY['INTERFONE'],
      ARRAY['assistencia','assistência','reinstalar','instalar central','central voltou'],
      jsonb_build_array(
        jsonb_build_object('name','Conectores/terminais','qty',10,'unit','un','sku','TERM','optional',false),
        jsonb_build_object('name','Placa fonte','qty',1,'unit','un','sku','INT-PL-FONTE','optional',true),
        jsonb_build_object('name','Placa ramal','qty',1,'unit','un','sku','INT-PL-RAMAL','optional',true)
      ),
      7, true
    ),

    -- CFTV
    ('cctv','Câmera estratégica sem imagem (portaria/entrada/elevador)', 120, 1, 'critical', 0, ARRAY['CFTV'],
      ARRAY['câmera','camera','sem imagem','portaria','entrada','elevador','sem video'],
      jsonb_build_array(
        jsonb_build_object('name','Conector BNC','qty',10,'unit','un','sku','BNC','optional',true),
        jsonb_build_object('name','Conector RJ45','qty',10,'unit','un','sku','RJ45','optional',true),
        jsonb_build_object('name','Fonte 12V (câmera)','qty',1,'unit','un','sku','PSU-12V','optional',true),
        jsonb_build_object('name','Monitor','qty',1,'unit','un','sku','MON','optional',true),
        jsonb_build_object('name','Cabo HDMI','qty',1,'unit','un','sku','HDMI','optional',true),
        jsonb_build_object('name','PC (diagnóstico/configuração)','qty',1,'unit','un','sku','PC','optional',true)
      ),
      12, true
    ),

    ('cctv','Câmera sem imagem (ponto comum)', 60, 1, 'non_critical', 2, ARRAY['CFTV'],
      ARRAY['câmera','camera','sem imagem','sem video','sem sinal camera'],
      jsonb_build_array(
        jsonb_build_object('name','Conector BNC','qty',10,'unit','un','sku','BNC','optional',true),
        jsonb_build_object('name','Conector RJ45','qty',10,'unit','un','sku','RJ45','optional',true),
        jsonb_build_object('name','Fonte 12V (câmera)','qty',1,'unit','un','sku','PSU-12V','optional',true)
      ),
      8, true
    ),

    ('cctv','Várias câmeras sem imagem (suspeita DVR/fonte geral)', 180, 1, 'critical', 0, ARRAY['CFTV'],
      ARRAY['várias câmeras','varias cameras','todas sem imagem','dvr','nvr','sem imagem geral'],
      jsonb_build_array(
        jsonb_build_object('name','DVR/NVR','qty',1,'unit','un','sku','DVR','optional',true),
        jsonb_build_object('name','HD para DVR/NVR','qty',1,'unit','un','sku','HDD-SURV','optional',true),
        jsonb_build_object('name','Conector BNC','qty',10,'unit','un','sku','BNC','optional',true),
        jsonb_build_object('name','Conector RJ45','qty',10,'unit','un','sku','RJ45','optional',true)
      ),
      11, true
    ),

    -- ACESSO
    ('access_control','Acesso pedestre – falha de liberação (porta/fecho)', 120, 1, 'critical', 0, ARRAY['CONTROLEDEACESSOPEDESTRE'],
      ARRAY['liberação','liberacao','porta','fecho','não libera','nao libera','acesso pedestre'],
      jsonb_build_array(
        jsonb_build_object('name','Fecho magnético','qty',1,'unit','un','sku','FECHO-MAG','optional',true),
        jsonb_build_object('name','Fonte 12V/24V','qty',1,'unit','un','sku','PSU-12-24','optional',true),
        jsonb_build_object('name','Botoeira','qty',1,'unit','un','sku','BOTOEIRA','optional',true),
        jsonb_build_object('name','Mola aérea','qty',1,'unit','un','sku','MOLA-AEREA','optional',true)
      ),
      10, true
    ),

    ('access_control','Acesso veicular – falha (módulo/tag/controle)', 120, 1, 'critical', 0, ARRAY['CONTROLEDEACESSOVEICULAR'],
      ARRAY['tag','controle','strobe','módulo','modulo','acesso veicular'],
      jsonb_build_array(
        jsonb_build_object('name','TAG de acesso','qty',10,'unit','un','sku','TAG','optional',true),
        jsonb_build_object('name','Controle remoto','qty',2,'unit','un','sku','CTRL','optional',true),
        jsonb_build_object('name','Strobe / Sinaleiro','qty',1,'unit','un','sku','STROBE','optional',true)
      ),
      9, true
    ),

    -- INFRA
    ('infra','Passagem de cabo (curta)', 120, 2, 'non_critical', 2, ARRAY['CFTV','INTERFONE'],
      ARRAY['passagem de cabo','puxar cabo','um ponto','ponto proximo','ponto próximo','curta'],
      jsonb_build_array(
        jsonb_build_object('name','Cabo','qty',20,'unit','m','sku','CABO','optional',true)
      ),
      4, true
    ),

    ('infra','Passagem de cabo (longa)', 240, 2, 'non_critical', 2, ARRAY['CFTV','INTERFONE'],
      ARRAY['passagem de cabo longa','muitos metros','vários pontos','varios pontos','infraestrutura','longa'],
      jsonb_build_array(
        jsonb_build_object('name','Cabo','qty',100,'unit','m','sku','CABO','optional',true)
      ),
      3, true
    ),

    -- GENERICOS
    ('admin', 'Atendimento administrativo', 30, 1, 'non_critical', 2, ARRAY['ADMIN'], ARRAY['administrativo','cadastro','assembleia'], '[]'::jsonb, 1, true),
    ('financial', 'Atendimento financeiro', 30, 1, 'non_critical', 2, ARRAY['FIN'], ARRAY['financeiro','boleto','pagamento','cobrança','cobranca'], '[]'::jsonb, 2, true)

  ) AS t(
    category, title, default_minutes, required_people, 
    criticality, sla_business_days, 
    required_skill_codes, match_keywords, 
    default_materials, match_priority, active
  )
)
INSERT INTO task_templates (
  category, title, default_minutes, required_people, 
  criticality, sla_business_days, 
  required_skill_codes, match_keywords, 
  default_materials, match_priority, active
)
SELECT 
  category, title, default_minutes, required_people, 
  criticality, sla_business_days, 
  required_skill_codes, match_keywords, 
  default_materials, match_priority, active
FROM templates
ON CONFLICT (category, title) 
DO UPDATE SET
  default_minutes = EXCLUDED.default_minutes,
  required_people = EXCLUDED.required_people,
  criticality = EXCLUDED.criticality,
  sla_business_days = EXCLUDED.sla_business_days,
  required_skill_codes = EXCLUDED.required_skill_codes,
  match_keywords = EXCLUDED.match_keywords,
  default_materials = EXCLUDED.default_materials,
  match_priority = EXCLUDED.match_priority,
  active = EXCLUDED.active;
