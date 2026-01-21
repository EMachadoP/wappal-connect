-- Migration: Seed G7 Task Templates (Complete)
-- Created: 2026-01-21
-- Purpose: Populates task_templates with G7 standard templates
-- Uses UPSERT pattern to prevent duplicates

-- Ensure unique constraint exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_task_templates_key') THEN
        CREATE UNIQUE INDEX uq_task_templates_key ON task_templates (category, title);
    END IF;
END $$;

-- Insert/Update all G7 templates
INSERT INTO task_templates (
  category, 
  title, 
  default_minutes, 
  required_people, 
  criticality, 
  sla_business_days, 
  required_skill_codes,
  match_keywords,
  default_materials,
  match_priority,
  active
)
VALUES
-- ═══════════════════════════════════════════════════════════════════════════
-- CFTV (Câmeras e Gravação)
-- ═══════════════════════════════════════════════════════════════════════════

('cftv', 'CFTV – Câmera sem imagem (padrão)', 60, 1, 'non_critical', 2, 
  ARRAY['CFTV'],
  ARRAY['camera','câmera','sem imagem','não aparece','nao aparece','tela preta','cftv'],
  jsonb_build_array(
    jsonb_build_object('name','Conector BNC','qty',2,'unit','un','sku','BNC','optional',false),
    jsonb_build_object('name','Conector RJ45','qty',2,'unit','un','sku','RJ45','optional',false),
    jsonb_build_object('name','Conectores diversos','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Fonte 12V','qty',1,'unit','un','sku','FONTE-12V','optional',true),
    jsonb_build_object('name','Cabo/Patch cord','qty',1,'unit','un','sku','PATCH','optional',true)
  ),
  5, true
),

('cftv', 'CFTV – Câmera estratégica sem imagem (portaria/entrada/elevador)', 90, 1, 'critical', 0, 
  ARRAY['CFTV'],
  ARRAY['camera estrategica','câmera estratégica','portaria','entrada','elevador','sem imagem','urgente'],
  jsonb_build_array(
    jsonb_build_object('name','Conector BNC','qty',2,'unit','un','sku','BNC','optional',false),
    jsonb_build_object('name','Conector RJ45','qty',2,'unit','un','sku','RJ45','optional',false),
    jsonb_build_object('name','Fonte 12V','qty',1,'unit','un','sku','FONTE-12V','optional',false),
    jsonb_build_object('name','Conectores diversos','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Patch cord','qty',2,'unit','un','sku','PATCH','optional',false),
    jsonb_build_object('name','Switch/porta reserva','qty',1,'unit','un','sku','SWITCH-PORT','optional',true)
  ),
  10, true
),

('cftv', 'CFTV – Várias câmeras sem imagem', 180, 2, 'critical', 0, 
  ARRAY['CFTV'],
  ARRAY['varias cameras','várias câmeras','multiplas','múltiplas','todas','sistema fora'],
  jsonb_build_array(
    jsonb_build_object('name','Conectores diversos','qty',2,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Cabos','qty',1,'unit','kit','sku','CABO-KIT','optional',false),
    jsonb_build_object('name','Fontes 12V','qty',2,'unit','un','sku','FONTE-12V','optional',false),
    jsonb_build_object('name','Ferramentas','qty',1,'unit','kit','sku','FERR-KIT','optional',false),
    jsonb_build_object('name','HD','qty',1,'unit','un','sku','HD-1TB','optional',true),
    jsonb_build_object('name','Porta DVR','qty',1,'unit','un','sku','DVR-PORT','optional',true)
  ),
  15, true
),

('cftv', 'CFTV – DVR/NVR com BIP / falha gravação', 120, 1, 'critical', 0, 
  ARRAY['CFTV'],
  ARRAY['dvr','nvr','bip','bipando','falha gravacao','falha gravação','não grava','nao grava','hd cheio'],
  jsonb_build_array(
    jsonb_build_object('name','HD','qty',1,'unit','un','sku','HD-1TB','optional',false),
    jsonb_build_object('name','DVR/NVR','qty',1,'unit','un','sku','DVR','optional',true),
    jsonb_build_object('name','Cabo HDMI','qty',1,'unit','un','sku','HDMI','optional',false),
    jsonb_build_object('name','Monitor/TV','qty',1,'unit','un','sku','MONITOR','optional',true)
  ),
  12, true
),

('cftv', 'CFTV – Acesso remoto sem funcionar', 60, 1, 'non_critical', 2, 
  ARRAY['CFTV'],
  ARRAY['acesso remoto','app','aplicativo','não conecta','nao conecta','internet','cloud'],
  jsonb_build_array(
    jsonb_build_object('name','Cabo de rede','qty',1,'unit','un','sku','CAT5E','optional',false),
    jsonb_build_object('name','Roteador/Config','qty',1,'unit','un','sku','ROUTER','optional',true),
    jsonb_build_object('name','Monitor','qty',1,'unit','un','sku','MONITOR','optional',true)
  ),
  3, true
),

('cftv', 'CFTV – Instalação novo ponto de câmera', 240, 2, 'non_critical', 2, 
  ARRAY['CFTV','PASSAGEM_DE_CABO'],
  ARRAY['instalacao','instalação','novo ponto','nova camera','nova câmera','adicionar'],
  jsonb_build_array(
    jsonb_build_object('name','Cabo coaxial/RJ45','qty',50,'unit','m','sku','CABO-CFTV','optional',false),
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Canaleta','qty',10,'unit','m','sku','CANALETA','optional',false),
    jsonb_build_object('name','Brocas','qty',1,'unit','kit','sku','BROCA-KIT','optional',false),
    jsonb_build_object('name','Fonte 12V','qty',1,'unit','un','sku','FONTE-12V','optional',false),
    jsonb_build_object('name','Caixas de passagem','qty',2,'unit','un','sku','CAIXA-PASS','optional',false)
  ),
  2, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- INTERFONE
-- ═══════════════════════════════════════════════════════════════════════════

('interfone', 'Interfone – Central fora do ar (retirada/instalação após assistência)', 240, 1, 'critical', 0, 
  ARRAY['INTERFONE'],
  ARRAY['central','fora do ar','não funciona','nao funciona','parou','sistema interfone'],
  jsonb_build_array(
    jsonb_build_object('name','Placa ramal','qty',1,'unit','un','sku','PLACA-RAMAL','optional',true),
    jsonb_build_object('name','Placa fonte','qty',1,'unit','un','sku','PLACA-FONTE','optional',true),
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Cabos','qty',1,'unit','kit','sku','CABO-KIT','optional',false)
  ),
  10, true
),

('interfone', 'Interfone – Apartamento sem chamada / ramal com defeito', 60, 1, 'non_critical', 2, 
  ARRAY['INTERFONE'],
  ARRAY['apartamento','ramal','sem chamada','não chama','nao chama','interfone apto','defeito'],
  jsonb_build_array(
    jsonb_build_object('name','Placa ramal','qty',1,'unit','un','sku','PLACA-RAMAL','optional',true),
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false)
  ),
  5, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- ANTENA COLETIVA
-- ═══════════════════════════════════════════════════════════════════════════

('antena_coletiva', 'Antena coletiva – Sem sinal geral', 120, 1, 'critical', 0, 
  ARRAY['ANTENACOLETIVA'],
  ARRAY['antena','sem sinal','sinal geral','tv','televisão','televisao','todos apartamentos'],
  jsonb_build_array(
    jsonb_build_object('name','Módulo de potência','qty',1,'unit','un','sku','MOD-POT','optional',false),
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Splitters','qty',2,'unit','un','sku','SPLITTER','optional',false),
    jsonb_build_object('name','Antena','qty',1,'unit','un','sku','ANTENA','optional',true)
  ),
  10, true
),

('antena_coletiva', 'Antena coletiva – Canais específicos falhando', 90, 1, 'non_critical', 2, 
  ARRAY['ANTENACOLETIVA'],
  ARRAY['canais','canal','específico','especifico','alguns canais','falhando','sem alguns'],
  jsonb_build_array(
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Splitter','qty',1,'unit','un','sku','SPLITTER','optional',false),
    jsonb_build_object('name','Módulo','qty',1,'unit','un','sku','MOD-ANT','optional',true)
  ),
  5, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- PORTÕES E MOTORES
-- ═══════════════════════════════════════════════════════════════════════════

('portao_veicular', 'Portão veicular – Motor sem funcionar', 120, 2, 'critical', 0, 
  ARRAY['PORTAO','CONTROLEDEACESSOVEICULAR'],
  ARRAY['portao','portão','motor','não funciona','nao funciona','parou','travado','veicular'],
  jsonb_build_array(
    jsonb_build_object('name','Placa do motor','qty',1,'unit','un','sku','PLACA-MTR','optional',false),
    jsonb_build_object('name','Engrenagem','qty',1,'unit','un','sku','ENGR','optional',true),
    jsonb_build_object('name','Cremalheira','qty',1,'unit','un','sku','CREM','optional',true),
    jsonb_build_object('name','Parafusos','qty',1,'unit','kit','sku','PARAF-KIT','optional',false)
  ),
  15, true
),

('portao_veicular', 'Portão veicular – Desalinhamento / trilho / roldanas', 120, 2, 'critical', 0, 
  ARRAY['PORTAO'],
  ARRAY['desalinhado','trilho','roldana','roldanas','saiu do trilho','emperrado','veicular'],
  jsonb_build_array(
    jsonb_build_object('name','Roldanas','qty',4,'unit','un','sku','ROLD','optional',false),
    jsonb_build_object('name','Parafusos','qty',1,'unit','kit','sku','PARAF-KIT','optional',false),
    jsonb_build_object('name','Graxa','qty',1,'unit','un','sku','GRAXA','optional',true)
  ),
  12, true
),

('porta_pedestre', 'Porta pedestre – Não fecha / mola aérea / fecho', 90, 1, 'critical', 0, 
  ARRAY['PORTODEPEDESTRE','CONTROLEDEACESSOPEDESTRE'],
  ARRAY['porta pedestre','não fecha','nao fecha','mola','mola aérea','mola aerea','fecho','pedestre'],
  jsonb_build_array(
    jsonb_build_object('name','Fecho magnético','qty',1,'unit','un','sku','FECHO-MAG','optional',false),
    jsonb_build_object('name','Mola aérea','qty',1,'unit','un','sku','MOLA','optional',true),
    jsonb_build_object('name','Fonte','qty',1,'unit','un','sku','FONTE-12V','optional',false),
    jsonb_build_object('name','Botoeira','qty',1,'unit','un','sku','BOTOEIRA','optional',true)
  ),
  10, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- CONTROLE DE ACESSO
-- ═══════════════════════════════════════════════════════════════════════════

('controle_acesso_pedestre', 'Acesso pedestre – Falha liberação (botoeira/leitor)', 90, 1, 'critical', 0, 
  ARRAY['CONTROLEDEACESSOPEDESTRE'],
  ARRAY['acesso','pedestre','botoeira','leitor','não libera','nao libera','biometria','cartão','cartao'],
  jsonb_build_array(
    jsonb_build_object('name','Fecho','qty',1,'unit','un','sku','FECHO-MAG','optional',false),
    jsonb_build_object('name','Fonte','qty',1,'unit','un','sku','FONTE-12V','optional',false),
    jsonb_build_object('name','Botoeira','qty',1,'unit','un','sku','BOTOEIRA','optional',true),
    jsonb_build_object('name','Cabo CCI','qty',10,'unit','m','sku','CCI','optional',false),
    jsonb_build_object('name','Módulo acesso','qty',1,'unit','un','sku','MOD-ACESSO','optional',true)
  ),
  10, true
),

('controle_acesso_veicular', 'Acesso veicular – TAG/controle não funciona / receptor', 60, 1, 'non_critical', 2, 
  ARRAY['CONTROLEDEACESSOVEICULAR'],
  ARRAY['tag','controle','receptor','não funciona','nao funciona','não abre','nao abre','veicular','garagem'],
  jsonb_build_array(
    jsonb_build_object('name','TAGs','qty',5,'unit','un','sku','TAG','optional',true),
    jsonb_build_object('name','Controle remoto','qty',2,'unit','un','sku','CTRL','optional',true),
    jsonb_build_object('name','Módulo acesso','qty',1,'unit','un','sku','MOD-ACESSO','optional',true),
    jsonb_build_object('name','Strobo','qty',1,'unit','un','sku','STROBO','optional',true)
  ),
  5, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- INFRAESTRUTURA / CABO
-- ═══════════════════════════════════════════════════════════════════════════

('infraestrutura', 'Passagem de cabo (infraestrutura)', 240, 2, 'non_critical', 2, 
  ARRAY['PASSAGEM_DE_CABO'],
  ARRAY['passagem','cabo','infraestrutura','passar cabo','lançamento'],
  jsonb_build_array(
    jsonb_build_object('name','Cabo (CCI/RJ45/Coax)','qty',100,'unit','m','sku','CABO-INFRA','optional',false),
    jsonb_build_object('name','Canaleta','qty',20,'unit','m','sku','CANALETA','optional',false),
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false),
    jsonb_build_object('name','Abraçadeiras','qty',1,'unit','pct','sku','ABRAC','optional',false)
  ),
  2, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- CERCA ELÉTRICA
-- ═══════════════════════════════════════════════════════════════════════════

('cerca_eletrica', 'Cerca elétrica – Não dispara / sem choque', 90, 1, 'critical', 0, 
  ARRAY['CERCAELETRICA'],
  ARRAY['cerca','elétrica','eletrica','não dispara','nao dispara','sem choque','alarme cerca'],
  jsonb_build_array(
    jsonb_build_object('name','Central de cerca','qty',1,'unit','un','sku','CENTRAL-CERCA','optional',true),
    jsonb_build_object('name','Isoladores','qty',10,'unit','un','sku','ISOLADOR','optional',false),
    jsonb_build_object('name','Fio de aço','qty',50,'unit','m','sku','FIO-ACO','optional',false),
    jsonb_build_object('name','Hastes','qty',2,'unit','un','sku','HASTE','optional',true)
  ),
  10, true
),

('cerca_eletrica', 'Cerca elétrica – Disparando sem motivo / falso alarme', 60, 1, 'non_critical', 2, 
  ARRAY['CERCAELETRICA'],
  ARRAY['cerca','elétrica','eletrica','disparando','falso alarme','sensibilidade'],
  jsonb_build_array(
    jsonb_build_object('name','Isoladores','qty',10,'unit','un','sku','ISOLADOR','optional',false),
    jsonb_build_object('name','Conectores','qty',1,'unit','kit','sku','CONN-KIT','optional',false)
  ),
  5, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- ALARME
-- ═══════════════════════════════════════════════════════════════════════════

('alarme', 'Alarme – Central com defeito / não arma', 120, 1, 'critical', 0, 
  ARRAY['ALARME'],
  ARRAY['alarme','central','não arma','nao arma','defeito','não funciona','nao funciona'],
  jsonb_build_array(
    jsonb_build_object('name','Central de alarme','qty',1,'unit','un','sku','CENTRAL-ALM','optional',true),
    jsonb_build_object('name','Bateria','qty',1,'unit','un','sku','BAT-12V','optional',false),
    jsonb_build_object('name','Sensores','qty',2,'unit','un','sku','SENSOR-IVP','optional',true),
    jsonb_build_object('name','Teclado','qty',1,'unit','un','sku','TECLADO-ALM','optional',true)
  ),
  10, true
),

('alarme', 'Alarme – Sensor com problema / não detecta', 60, 1, 'non_critical', 2, 
  ARRAY['ALARME'],
  ARRAY['sensor','não detecta','nao detecta','falha sensor','ivp','infravermelho'],
  jsonb_build_array(
    jsonb_build_object('name','Sensor IVP','qty',2,'unit','un','sku','SENSOR-IVP','optional',false),
    jsonb_build_object('name','Bateria sensor','qty',2,'unit','un','sku','BAT-CR123','optional',true),
    jsonb_build_object('name','Cabo','qty',10,'unit','m','sku','CABO-ALM','optional',true)
  ),
  5, true
),

-- ═══════════════════════════════════════════════════════════════════════════
-- CONCERTINA
-- ═══════════════════════════════════════════════════════════════════════════

('concertina', 'Concertina – Instalação / reposição', 180, 2, 'non_critical', 2, 
  ARRAY['CONCERTINA'],
  ARRAY['concertina','arame','farpado','instalação','instalacao','muro','perímetro','perimetro'],
  jsonb_build_array(
    jsonb_build_object('name','Concertina (rolo)','qty',2,'unit','un','sku','CONC-ROLO','optional',false),
    jsonb_build_object('name','Grampos','qty',1,'unit','pct','sku','GRAMPO','optional',false),
    jsonb_build_object('name','Braçadeiras','qty',10,'unit','un','sku','BRAC','optional',false)
  ),
  3, true
)

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

-- Confirmar inserção
SELECT 
  category, 
  title, 
  default_minutes || ' min' as duracao,
  required_people as pessoas,
  criticality,
  sla_business_days as sla,
  array_to_string(required_skill_codes, ', ') as skills
FROM task_templates 
WHERE active = true
ORDER BY category, match_priority DESC;
