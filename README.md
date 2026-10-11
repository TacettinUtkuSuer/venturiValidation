# VenturiFlow Master

**Web tabanlı Venturi tasarım, doğrulama, yerinde kalibrasyon ve canlı izleme aracı.** ISO 5167-4 / ASME MFC-3M / Bernoulli hesap motoru, ölçekli 2D çizim, performans eğrisi, What-If simülasyonu, Coriolis referanslı kalibrasyon ve **Beckhoff TwinCAT 3 / IEC 61131-3 PLC kodu üretimi**, InfluxDB v1 telemetrisi, akıllı CSV içe aktarma, JSON yedekleme ve A4 PDF raporu tek bir statik sayfada.

- **Sıfır kurulum:** Build/derleme yok. Saf HTML5 + Vanilla JS + CSS. Doğrudan tarayıcıda veya GitHub Pages'te çalışır.
- **Okunaklı SCADA/HMI arayüzü:** 1920×1080 için düzenlenmiştir; büyük yazı ve göstergeler, gerektiğinde dikey kaydırma, sabit (sticky) giriş paneli. Gece/Gündüz modu vardır, varsayılan Gece modudur.
- **Çoklu venturi:** Her venturinin tasarımı, sensörleri, ölçümleri ve kalibrasyonu ayrı saklanır; kopyalanıp yeni venturide değiştirilebilir.
- **Kalıcılık:** Ayarlar `localStorage`'da saklanır, JSON ile dışa/içe aktarılabilir ve [Ortak Kayıt](#ortak-kayıt-github-ile-tüm-bilgisayarlarda-aynı-veri) ile GitHub üzerinden tüm bilgisayarlarda otomatik eşitlenir.

---

## İçindekiler

1. [Hızlı Başlangıç](#hızlı-başlangıç)
2. [Modüller](#modüller)
3. [Matematiksel Model](#matematiksel-model)
4. [Çoklu Venturi](#çoklu-venturi)
5. [Kalibrasyon & PLC (TwinCAT 3)](#kalibrasyon--plc-twincat-3)
6. [GitHub Pages ile Yayınlama](#github-pages-ile-yayınlama)
7. [Ortak Kayıt (GitHub ile Tüm Bilgisayarlarda Aynı Veri)](#ortak-kayıt-github-ile-tüm-bilgisayarlarda-aynı-veri)
8. [InfluxDB v1 Kurulumu ve Bağlantı](#influxdb-v1-kurulumu-ve-bağlantı)
9. [HTTPS / Mixed Content Sorunu](#https--mixed-content-sorunu)
10. [CSV Formatları](#csv-formatları)
11. [Dosya Yapısı](#dosya-yapısı)
12. [Testler](#testler)
13. [Varsayımlar ve Sınırlamalar](#varsayımlar-ve-sınırlamalar)

---

## Hızlı Başlangıç

Kurulum gerekmez. Üç yoldan biriyle açın:

| Yol | Nasıl | Ne zaman |
|---|---|---|
| **GitHub Pages linki** (önerilen) | `https://tacettinutkusuer.github.io/venturiValidation/` adresini açın | Paylaşım ve günlük kullanım. Pages'in açık olması gerekir, bkz. [GitHub Pages ile Yayınlama](#github-pages-ile-yayınlama) |
| **ZIP** | Depo sayfası → **Code → Download ZIP** → `index.html`'e çift tıklayın | Tek bilgisayar, **internetsiz** tesis ağı, InfluxDB'ye HTTP ile bağlanılacaksa |
| **Yerel sunucu** (isteğe bağlı) | Klasörde `python -m http.server 8080` → `http://localhost:8080` | InfluxDB bağlantısında tarayıcı izniyle uğraşmamak için |

**İnternet gerekmez.** Tüm kütüphaneler depoda (`lib/`) bulunur; uygulama tesis ağındaki internetsiz SCADA bilgisayarlarında da tam çalışır. Yalnızca ortak kayıt (GitHub) özelliği internete çıkar.

| Kütüphane | Sürüm | Lisans | Kullanım |
|---|---|---|---|
| Chart.js | 4.4.1 | MIT | Performans eğrisi, trend, kalibrasyon ve akışkan grafikleri |
| MathJax (tex-svg) | 3.2.2 | Apache-2.0 | Formül paneli, PDF denklemleri, yardım penceresi |
| html2pdf.js | 0.10.1 | MIT | A4 PDF raporu |
| marked | 12.0.2 | MIT | **?** düğmesindeki kullanım kılavuzu (bu README) |

Üst çubuktaki **?** düğmesi bu README'yi içindekiler listesi ve başlık aramasıyla uygulama içinde açar.

---

## Modüller

### MODÜL 1 — Standartlar, Matematik Motoru & Akışkan Fiziği

| Metot | İmalat tipi | C | U(C) | D aralığı | β aralığı | Re_D aralığı |
|---|---|---|---|---|---|---|
| ISO 5167-4 / ASME MFC-3M | Ham döküm konvergent (as-cast) | 0,984 | %0,7 | 100–800 mm | 0,30–0,75 | 2·10⁵ – 2·10⁶ |
| ISO 5167-4 / ASME MFC-3M | İşlenmiş konvergent (machined) | 0,995 | %1,0 | 50–250 mm | 0,40–0,75 | 2·10⁵ – 1·10⁶ |
| ISO 5167-4 / ASME MFC-3M | Kaba kaynaklı sac (rough-welded) | 0,985 | %1,5 | 200–1200 mm | 0,40–0,70 | 2·10⁵ – 2·10⁶ |
| Basit Bernoulli | Kullanıcı tanımlı C_d | girdi | girdi | — | öneri 0,2–0,8 | — |

Hesaplanan büyüklükler:

- **Toplam ölçüm belirsizliği:** C, ε, D/d geometri toleransları, transmitter doğruluğu ve yoğunluk birleştirilir. Sonuç `Toplam Belirsizlik: ±%1.02` biçiminde gösterilir.
- **Kalıcı basınç kaybı ve geri kazanım:** Difüzör açısına bağlı olarak hesaplanır ve mbar (veya seçilen birim) cinsinden vurgulanır.
- **Kavitasyon (sıvılar):** Boğaz basıncı p₂ ile buhar basıncı p_v karşılaştırılır. Kavitasyon sayısı σ ve kavitasyonun başladığı debi hesaplanır.
- **Genleşme (gazlar):** Genleşme faktörü ε (Y) ISO 5167-4 Denk. 2 ile hesaplanır, τ = p₂/p₁ ≥ 0,75 sınırı kontrol edilir.
- **Canlı formül paneli:** Seçilen metodun denklemleri MathJax ile hem sembolik hem de sayılar yerine konmuş hâlde gösterilir.
- **Düz boru rehberi:** Memba elemanına ve β'ya göre gereken giriş (D cinsinden) ve çıkış (d cinsinden) düz boru uzunlukları verilir.
- **Uygunluk kontrolleri:** D, β, Re_D, τ, difüzör açısı, hat basıncı ve kavitasyon için ✓/✗ listesi gösterilir.

### MODÜL 2 — Dinamik Birim Dönüştürücü

| Büyüklük | Birimler |
|---|---|
| Debi | LPM, m³/h, kg/s, kg/h, GPM (US) |
| Basınç | mbar, bar, Pa, kPa, psi, mmH₂O |
| Boyut | mm, cm, inch, m |
| Sıcaklık | °C, K, °F |
| Yoğunluk | kg/m³, g/cm³ |
| Viskozite | cP, Pa·s, cSt |

- Her giriş alanının yanında bir birim kutusu vardır. Birim değiştirildiğinde mevcut değer otomatik dönüştürülür.
- **Birimler** sekmesinden göstergelerin, grafiğin ve raporun gösterim birimleri seçilir. Aynı sekmede hızlı bir dönüştürücü de vardır.
- Hacimsel ↔ kütlesel debi ve cSt ↔ cP dönüşümleri, işletme koşullarındaki akışkan yoğunluğunu kullanır.

### MODÜL 3 — Akışkan Yönetimi & Akıllı CSV İçe Aktarma

- **Sıvı / Gaz seçimi:** Gaz seçildiğinde izentropik üs κ, molar kütle M ve sıkıştırılabilirlik Z alanları açılır. M girilirse yoğunluk ρ = p₁M/(ZRT) ile hesaplanır.
- **Viskozite zorunludur:** Girilmezse hesap durur ve üst çubukta hata gösterilir.
- **Hazır kütüphane:** Su (0–100 °C özellik tablosu), Hava, Doğal Gaz, Azot, Su–Glikol %30, Dizel. Kullanıcı yeni akışkan ekleyebilir, kopyalayabilir veya silebilir.
- **Sıcaklığa bağlı özellik grafiği:** ρ, μ, ν veya pᵥ'nin sıcaklıkla değişimi; tablo noktaları ve işletme sıcaklığı işaretli.
- **Akıllı CSV içe aktarma:**
  - Ayırıcı (`;`, `,`, TAB, `|`) ve ondalık biçimi (`12,5` / `12.5`) otomatik algılanır.
  - Sütunlar başlık adlarından tahmin edilir. Birimler de başlıklardan tahmin edilir (`(°C)`, `[mbar]`, `m3/h` gibi).
  - Kullanıcı eşleştirme ekranında her büyüklük için sütunu ve birimi seçer.
  - İki içe aktarma modu vardır:
    1. **Akışkan özellik tablosu** (T–ρ–μ–p_v): İşletme sıcaklığına göre doğrusal interpolasyon yapılır.
    2. **Ölçüm verisi** (Debi–ΔP): Noktalar teorik eğri üzerinde gösterilir ve doğrulamada kullanılır.

### MODÜL 4 — Compact Dashboard & What-If Simülasyonu

- **Boru kütüphanesi:** DN50–DN200 (EN 10220) ile ANSI 2"–8" Sch40/Sch80 iç çapları. Boru seçildiğinde β korunarak boğaz çapı yeniden hesaplanır.
- **Ölçekli 2D SVG kesit:** Giriş silindiri, 21° konvergent, boğaz, difüzör, p₁/p₂ basınç prizleri ve ölçülendirme çizilir. Altında basınç profili gösterilir.
- **Performans eğrisi (Chart.js):** X ekseni debi, Y ekseni ΔP'dir. Eğri tasarım debisinin %0–125'ini kapsar. Grafikte ayrıca:
  - ±U belirsizlik bandı,
  - tasarım maksimumu,
  - kavitasyon başlangıcı veya τ = 0,75 sınırı (dikey çizgiler),
  - CSV ölçüm noktaları.
- **What-If kaydırıcısı:** Çalışma noktası tasarım debisinin %0–125'i arasında kaydırılır. Grafikteki mor nokta ve tüm hesaplar anlık güncellenir.

### MODÜL 5 — InfluxDB v1 Entegrasyonu & Telemetri

- InfluxDB 1.x HTTP API'sine (`/ping`, `/query`) InfluxQL ile bağlanılır. Varsayılanlar: `http://10.10.2.6:8086`, db `lc_100`, measurement `telemetry`. Bağlantı ayarları **her venturiye özeldir** (farklı venturiler farklı sunucu/veritabanında olabilir); yeni venturi açık olanın bağlantısını devralır.
- **Sensör adı:** Her sensör için sadece adı yazılır (ör. `P1`). Varsayılan olarak ad, **field adı** kabul edilir:

  ```sql
  SELECT last("P1") FROM "telemetry" WHERE time > now() - 300s
  ```

  Ad bir tag değeriyse "Sensör adı nerede? → Tag değeri" seçilir; tag anahtarı ve değer field'ı girilir.
- **Sorgu penceresi (dk):** Son X dakikada veri yoksa sensör "veri yok" olarak işaretlenir, eski değer canlıymış gibi gösterilmez. 30 sn'den eski veride durum ışığı kırmızıya döner.
- **Yenileme periyodu:** Milisaniye cinsinden, en az 250 ms.
- **ΔP kaynağı (venturiye özel):**
  - **Doğrudan:** ΔP transmitteri.
  - **P1 − P2:** Giriş ve boğaz basınçlarının farkı.

  P1/P2 için gösterge (bar g) veya mutlak basınç seçilir. P1 girilirse canlı p₁ (mutlak) teorik hesapta ve kavitasyon payında (p₂ − pᵥ) kullanılır.
- **Sensörler (venturiye özel):** ΔP, P1, P2, debi (Coriolis), sıcaklık, yoğunluk (Coriolis). Her biri için:
  - ad ve birim,
  - **a·x + b düzeltmesi** (ham değer önce bu düzeltmeden geçer),
  - **kendi hareketli ortalaması** (ham, 3/5/6/10/12/20/30, özel, tümü).

  Her sensör kartının altında ham, düzeltilmiş ve ortalama değer ile tampon doluluğu gösterilir.
- **＋ Kalibrasyona ekle:** Anlık ortalama ΔP, Coriolis debi, T, ρ ve P1 değerlerini tek tıkla kalibrasyon tablosuna ekler.
- **⊘ ΔP sıfırla:** Akış durmuşken ΔP'yi sıfırlar; ofset (b) otomatik hesaplanır ve kaydedilir. Doğrudan modda ΔP kartında, P1 − P2 modunda P2 kartındadır (P2'nin ofseti, P1 − P2 = 0 olacak şekilde ayarlanır). Onay istenir.
- **Zaman trendi:** Performans grafiği kartındaki **Zaman trendi** sekmesi; hesaplanan debi, Coriolis debisi, ΔP ve sapma %'nin son 2/5/10/30/60 dakikalık grafiği. Göstergeye tıklayarak seri gizlenir/açılır.
- **Doğrulama:** Coriolis debisi ile hesaplanan debi arasındaki sapma gösterilir ve belirsizlik sınırına göre ✓/✗ değerlendirilir. Kalibrasyon aktifse hesap kalibre modelle yapılır ve sınır kalibre belirsizliktir.
- **HTTPS Mixed Content:** Bu durum otomatik algılanır. Hem bir uyarı hem de adım adım bir izin rehberi (popup) gösterilir.
- **Demo modu:** InfluxDB olmadan sentetik veriyle canlı ekran test edilebilir.

### MODÜL 6 — Yedekleme ve PDF Raporlama

- **JSON Yedekle / Yükle:** Tüm ayarlar, akışkanlar (tablolar dahil), ölçüm verisi ve InfluxDB yapılandırması dışa/içe aktarılır. Parola girildiyse yedek dosyada yer alır, uyarı gösterilir.
- **PDF Rapor:** Tek tıkla A4 dikey rapor indirilir. İçeriği:
  - ölçekli çizim,
  - geometri, akışkan ve işletme tabloları,
  - çalışma noktası ve maksimum debi sonuçları,
  - performans eğrisi,
  - belirsizlik bütçesi,
  - uygunluk kontrolleri,
  - düz boru mesafeleri,
  - kullanılan denklemler (MathJax görüntüleri).

  Rapor her zaman açık temada üretilir.

---

## Matematiksel Model

Tüm iç hesaplar SI birimlerinde yapılır.

### Temel debi denklemi (ISO 5167-1 / -4)

$$q_m = \frac{C\,\varepsilon}{\sqrt{1-\beta^4}}\;\frac{\pi}{4}\,d^2\,\sqrt{2\,\Delta p\,\rho_1}, \qquad \beta = \frac{d}{D}, \qquad E = \frac{1}{\sqrt{1-\beta^4}}$$

- **ΔP → debi:** Doğrudan çözülür.
- **Debi → ΔP:** Gazlarda ε, ΔP'ye bağlı olduğundan sabit nokta iterasyonu kullanılır (yakınsama 10⁻⁹).

### Genleşme faktörü (ISO 5167-4, Denk. 2)

$$\varepsilon = \sqrt{\left(\frac{\kappa\,\tau^{2/\kappa}}{\kappa-1}\right)\left(\frac{1-\beta^4}{1-\beta^4\,\tau^{2/\kappa}}\right)\left(\frac{1-\tau^{(\kappa-1)/\kappa}}{1-\tau}\right)}, \qquad \tau = \frac{p_2}{p_1} = \frac{p_1-\Delta p}{p_1}$$

Sıvılarda ε = 1 alınır. Geçerlilik koşulu τ ≥ 0,75'tir.

### Reynolds sayısı

$$Re_D = \frac{4\,q_m}{\pi\,\mu\,D}$$

### Kalıcı basınç kaybı ve geri kazanım

Difüzör kaybı Gibson konik difüzör korelasyonu ile, konvergent ve boğaz sürtünmesi ise sabit bir katsayıyla modellenir:

$$\Delta\varpi = \Big[k_d(\varphi)\,(1-\beta^2)^2 + K_c\Big]\,\tfrac12\,\rho\,v_2^2, \qquad K_c = 0{,}035$$

$$\Delta p_{rec} = \Delta p - \Delta\varpi$$

k_d(φ) değerleri φ (difüzör toplam açısı) için tablodan doğrusal interpolasyonla alınır:

| φ | 5° | 7° | 10° | 15° | 20° | 30° |
|---|---|---|---|---|---|---|
| k_d | 0,13 | 0,14 | 0,17 | 0,27 | 0,43 | 0,81 |

Tipik sonuç ΔP'nin %5–20'sidir; bu, ISO 5167-4'ün klasik Venturi için verdiği aralıkla uyumludur.

### Kavitasyon (sıvılar)

$$p_2 = p_1 - \Delta p, \qquad \sigma = \frac{p_2 - p_v}{\tfrac12\,\rho\,v_2^2}$$

| Koşul | Durum |
|---|---|
| p₂ ≤ p_v | **Kavitasyon var** |
| σ < 1 | **Yüksek risk** |
| Diğer | Düşük risk |

Kavitasyonun başladığı debi, ΔP = p₁ − p_v koşulundan hesaplanır.

### Birleşik belirsizlik (ISO 5167-1, Ek E)

$$\frac{\delta q_m}{q_m} = \sqrt{\left(\frac{\delta C}{C}\right)^2 + \left(\frac{\delta \varepsilon}{\varepsilon}\right)^2 + \left(\frac{2\beta^4}{1-\beta^4}\right)^2\left(\frac{\delta D}{D}\right)^2 + \left(\frac{2}{1-\beta^4}\right)^2\left(\frac{\delta d}{d}\right)^2 + \frac14\left(\frac{\delta \Delta p}{\Delta p}\right)^2 + \frac14\left(\frac{\delta \rho_1}{\rho_1}\right)^2}$$

Bileşenler şöyle belirlenir:

- **ε belirsizliği:** δε/ε = (4 + 100β⁸)·Δp/p₁ % (ISO 5167-4 §5.7).
- **Transmitter belirsizliği:** δΔp/Δp = (doğruluk % span) × span / Δp. Span doğruluğu okumaya bu şekilde çevrilir; bu yüzden düşük debilerde belirsizlik artar.
- **Diğer bileşenler:** Kullanıcı girdisidir. Tümünün %95 güven düzeyinde verildiği varsayılır.

### Geometri (çizim)

- Konvergent toplam açısı 21° alınır (ISO 5167-4).
- Boğaz uzunluğu = d.
- Konvergent uzunluğu L_c = (D − d) / (2·tan 10,5°).
- Difüzör uzunluğu L_d = (D − d) / (2·tan(φ/2)).

### Düz boru mesafeleri

Memba mesafeleri ISO 5167-4 Tablo 1 esas alınarak β = 0,30 … 0,75 aralığında doğrusal interpolasyonla bulunur. Mansap için boğaz prizinden itibaren ≥ 4d alınır.

---

## Çoklu Venturi

Üst çubuktaki **VENTURİ** seçicisi aktif venturiyi gösterir:

| Düğme | İşlev |
|---|---|
| Seçici | Venturiler arasında geçiş. Mevcut venturi otomatik kaydedilir, seçilen yüklenir. |
| **＋** | Varsayılan değerlerle yeni venturi. |
| **⧉** | Açık venturinin kopyası. Kopya açılır, üzerinde değişiklik yapılabilir; asıl venturi etkilenmez. |
| **☰ Venturiler** | Tüm liste: ad ve not/konum düzenleme, geometri/akışkan/ΔP sensörü/kalibrasyon özeti, aç, kopyala, tek venturiyi JSON olarak indir (⤓), sil, venturi dosyası içe aktar. |

**Her venturiye özel olanlar (akışkan kütüphanesi dışındaki her şey):** Standart ve imalat tipi, geometri ve işletme girdileri, akışkan seçimi, gösterim birimleri, What-If noktası, ölçüm (CSV) verisi, kalibrasyon test noktaları ve model ayarları, InfluxDB bağlantısı, sensör adları/birimleri/a·x+b düzeltmeleri/ortalamaları, ΔP kaynağı, trend ve grafik seçimleri.

**Tüm venturiler için ortak olan:** Akışkan kütüphanesi (bir akışkan tanımı birden çok venturide kullanılabilir).

**Bu bilgisayara özel olanlar:** Tema, açık sekme/ekran, hangi venturinin açık olduğu ve InfluxDB parolası (ortak kayda yazılmaz).

**Kayıt ve paylaşım:**
- **Tek venturi dosyası** (⤓): Kullandığı akışkan tanımını da içerir. Başka bir bilgisayarda "☰ Venturiler → Venturi dosyası içe aktar" veya üst çubuktaki **JSON Yükle** ile yeni venturi olarak eklenir.
- **JSON Yedekle:** Girilen **her değeri** içerir: tüm venturiler, akışkanlar, birimler, InfluxDB ayarları, dönüştürücü ve grafik seçimleri.
- **Ortak kayıt (GitHub):** Tüm venturiler paylaşılır ve **venturi bazında birleştirilir** (ayrıntı: [Ortak Kayıt](#ortak-kayıt-github-ile-tüm-bilgisayarlarda-aynı-veri)).

Eski sürümden gelen kayıtlar otomatik olarak "Venturi 1" adlı tek bir venturiye taşınır.

---

## Kalibrasyon & PLC (TwinCAT 3)

Üst çubuktaki **Kalibrasyon & PLC** ekranı, sahada yapılan testlerden tesisinize özel debi formülünü çıkarır ve PLC koduna dönüştürür. Kötü imalat, dirsekler, kaynak çapakları veya doğrusal olmayan davranış nedeniyle teorik formülün tutmadığı durumlar için tasarlanmıştır.

### İş akışı

1. **Akışkan sekmesinde** sıcaklığa bağlı özellik tablosu olan akışkanı seçin (su hazırdır; diğerleri için CSV ile T–ρ–μ tablosu yükleyin). Bu tablo olmadan sıcaklık kompanzasyonu yapılamaz.
2. **Kalibrasyon ayarlarında** işletmedeki en düşük ve en yüksek sıcaklığı ve Coriolis doğruluğunu girin.
3. **Test noktalarını** girin: Coriolis referans debisi, aynı anda ΔP, sıcaklık (ve isterseniz Coriolis yoğunluğu). Üç yol vardır:
   - tabloya elle yazmak (Enter ile alt satıra geçilir),
   - CSV içe aktarmak (sütun eşleştirmeli),
   - **Canlı** sekmesinde **＋ Kalibrasyona ekle** ile InfluxDB'den gelen ortalama değeri eklemek,
   - **Geçmiş veriden…** ile InfluxDB'deki bir zaman aralığından kararlı bölümleri otomatik bulmak (aşağıya bakın).
4. **Model karşılaştırmasını** inceleyin; önerilen model otomatik seçilir. İsterseniz başka bir modeli seçin.
5. **PLC Çıktısı** bölümünden TwinCAT 3 kodunu kopyalayın.
6. İsterseniz **"Canlı izleme ve grafikte kalibre modeli kullan"** kutusunu işaretleyin; canlı debi hesabı ve ana grafikteki pembe kesikli eğri kalibre modele göre çalışır.

### Geçmiş veriden kalibrasyon

Test sırasında her noktayı tek tek eklemek yerine, testi InfluxDB'ye kaydedip sonra toplu işleyebilirsiniz:

1. Kalibrasyon ekranında **Geçmiş veriden…** düğmesine basın.
2. Başlangıç–bitiş zamanını, gruplama süresini (ör. 10 sn), kararlılık süresini (ör. 120 sn) ve izin verilen dalgalanmaları (debi ≤ %0,5, ΔP ≤ %1) girin.
3. **Verileri Getir ve Bölümleri Bul**: uygulama, debinin ve ΔP'nin belirtilen süre boyunca kararlı kaldığı bölümleri bulur, grafikte işaretler ve her bölümün ortalamasını tabloda listeler.
4. İstediğiniz bölümleri seçip **Seçilenleri kalibrasyona ekle** deyin.

Sensör adları, a·x+b düzeltmeleri, birimler ve ΔP kaynağı (doğrudan veya P1 − P2) Canlı sekmesindeki ayarlardan alınır. Coriolis debi sensörü tanımlı olmalıdır.

### Gaz kalibrasyonu

Akışkan **gaz** ise (Akışkan sekmesinde tip: Gaz, κ ve tercihen M/Z girilmiş):
- Tüm modellerde h = **ε**·√(ρ·ΔP) kullanılır; genleşme faktörü ε her test noktasının kendi P1 (mutlak) basıncıyla ISO 5167-4 Denk. 2'den hesaplanır.
- Test tablosunda **P1 mutlak** sütunu görünür (boşsa tasarım p₁ kullanılır). Canlıdan ve geçmiş veriden eklenen noktalar P1'i otomatik alır.
- Yoğunluk M girildiyse ideal gaz denkleminden (ρ = p₁M/ZRT), yoksa ölçülen yoğunluktan alınır.
- Üretilen PLC kodu ek bir **fP1** (mutlak) girişi alır; ε ve ideal gaz yoğunluğunu PLC içinde hesaplar.

### İyi bir test için

| Öneri | Neden |
|---|---|
| %10–100 debi aralığında **8–12 nokta**, düşük debide daha sık | Doğrusal olmama genelde düşük debide büyüktür |
| Her noktada debi oturduktan sonra **30–60 sn ortalama** | Gürültüyü azaltır (Canlı sekmesindeki hareketli ortalama bunun içindir) |
| Noktaları **artan ve azalan** yönde tekrarlayın | Tekrarlanabilirliği ölçer |
| Akış yokken **ΔP sıfırını** kontrol edin | Sıfır kayması düşük debide büyük hata yapar |
| Mümkünse **farklı sıcaklıklarda** da nokta alın | Sıcaklık kompanzasyonunu doğrular |
| Kalibrasyondan sonra **tesisata dokunmayın** | Katsayılar sadece bu tesisat için geçerlidir |

**Önemli:** Kalibrasyon **sabit** hataları düzeltir. Dirsek kaynaklı girdap ölçümü **tekrarlanamaz** hâle getiriyorsa (aynı debide ΔP oynuyorsa) hiçbir katsayı bunu düzeltemez. Uygulama bu durumu "Veri Kalitesi" kartında tekrarlanabilirlik değeriyle gösterir ve uyarır.

### Modeller

Tüm modeller yoğunluk kompanzasyonludur: h = ε·√(ρ·ΔP) (sıvıda ε = 1, gazda ISO 5167-4 genleşme faktörü). C(Re) modelleri ayrıca viskoziteyi, yani sıcaklığın Reynolds sayısı üzerinden debi katsayısına etkisini kompanze eder.

| Model | Formül | Sıcaklık kompanzasyonu |
|---|---|---|
| Tek katsayı | q = K·h | ρ(T) |
| Üslü | q = K·(h²)ⁿ | ρ(T) |
| Polinom | q = a₀ + a₁·h + a₂·h² | ρ(T) |
| K düzeltme tablosu | q = K(ΔP)·h, doğrusal interpolasyon | ρ(T) |
| **C(Re) polinom** | q = C(Re)·E·A₂·√2·h, C = c₀ + c₁L + c₂L², L = log₁₀Re | **ρ(T) + μ(T)** |
| **C(Re) tablosu** | C, log₁₀Re'ye göre tablodan | **ρ(T) + μ(T)** |

- **Model kıyası:** Her model **birini dışarıda bırak (LOO) çapraz doğrulamasıyla** test edilir. Her nokta, o nokta hariç uydurulan modelle tahmin edilir. Bu, tabloların "her noktadan geçip" yanıltıcı biçimde sıfır hata göstermesini önler.
- **Öneri kuralı:** Benzer doğruluktakiler (0,15 puan içinde) arasında en basit model önerilir. İşletmede viskozite 1,3 kattan fazla değişiyorsa sadece C(Re) modelleri önerilir.
- **Tahmini kalibre belirsizlik (%95):** √(U_ref² + (2·RMS_LOO)²).
- **ρ(T) ve μ(T):** PLC'de sıcaklıktan hesaplanır: ρ = r₀ + r₁t + r₂t², ln μ = m₀ + m₁x + m₂x², x = 1000/T[K]. Katsayılar akışkan tablosundan işletme aralığına uydurulur ve hata payları kod başlığına yazılır.

### TwinCAT 3'e aktarma

1. **PLC projesi → POUs → Add → POU…** → tip **Function Block**, dil **Structured Text (ST)**, ad `FB_VenturiFlow`.
2. Uygulamadaki **1 · Bildirim** bloğunu editörün **üst** paneline, **2 · Uygulama** bloğunu **alt** paneline yapıştırın.
3. **3 · Kullanım örneği**ndeki gibi `MAIN` içinde çağırın:

```iecst
fbVenturi(fDp := fDp_mbar, fTemp := fTemp_C, fDensityIn := fRho);   (* fRho = 0 → ρ(T) *)
fFlow_kgh := fbVenturi.fMassFlow;    (* kg/h *)
fFlow_m3h := fbVenturi.fVolFlow;     (* m3/h *)
```

FB'nin diğer çıkışları:

| Çıkış | Anlamı |
|---|---|
| `fDensity` | Kullanılan yoğunluk |
| `fViscosity` | Dinamik viskozite |
| `fRe` | Reynolds sayısı |
| `fCd` | Etkin boşaltma katsayısı |
| `bLowFlowCut` | Düşük debi kesmesi aktif |
| `bOutOfRange` | ΔP veya T kalibrasyon aralığı dışında |

**Çıktı formatları:**
- Kod `LREAL` kullanır ve eski IDE'lerde karakter sorunu olmaması için tamamen ASCII'dir.
- **Genel IEC 61131-3 ST** sekmesi `REAL` tipli, `END_FUNCTION_BLOCK` içeren tek dosyalık sürümdür (CODESYS tabanlı PLC'ler vb.).
- **Katsayılar** sekmesi HMI veya farklı bir PLC için düz metin listesidir.

---

## GitHub Pages ile Yayınlama

1. Depoyu GitHub'a gönderin. `index.html` kök dizinde olmalıdır.
2. **Settings → Pages** sayfasına gidin.
3. **Source** olarak *Deploy from a branch* seçin. **Branch** olarak `main`, klasör olarak `/ (root)` seçip **Save** deyin.
4. Birkaç dakika sonra uygulama `https://<kullanıcı>.github.io/venturiValidation/` adresinde yayında olur.
5. Depodaki `.nojekyll` dosyası Jekyll işlemesini kapatır; dosyalar olduğu gibi sunulur.

> GitHub Pages yalnızca HTTPS ile sunulur. Yerel ağdaki HTTP InfluxDB'ye bağlanmak için [Mixed Content](#https--mixed-content-sorunu) bölümüne bakın.

---

## Ortak Kayıt (GitHub ile Tüm Bilgisayarlarda Aynı Veri)

Tasarımlar, akışkanlar, ölçüm verisi ve InfluxDB ayarları GitHub'daki bir veri deposunda tek bir JSON dosyasında tutulur. Tüm bilgisayarlar aynı veriyi görür. Ayrı bir sunucu gerekmez.

**Nasıl çalışır:**
- Bir bilgisayarda ortak parola **bir kez** girilir; sonrasında değişiklikler ~5 saniye içinde otomatik kaydedilir. Her kayıt bir commit'tir, geçmiş GitHub'da durur.
- Uygulama açılışta ve dakikada bir (salt okunur bilgisayarlarda 3 dakikada bir) ortak dosyayı kontrol eder, yeni sürüm varsa yükler.
- Parolası girilmemiş bilgisayarlar **salt okunur** çalışır (veri deposu public ise).
- **Venturi bazında birleştirme:** Ortak dosya siz çalışırken değiştiyse her venturi ve akışkan ayrı ayrı karşılaştırılır:
  - yalnız bir tarafta değişen öğe otomatik alınır,
  - yeni eklenen venturiler iki taraftan da korunur, silinenler silinir,
  - **yalnızca aynı venturi iki bilgisayarda da değiştiyse** sorulur: *İkisini de tut* (varsayılan; sizinki "(bu bilgisayar)" ekiyle ayrı kayıt olur), *Benimki* veya *Ortaktaki*.
- Bir bilgisayar ortak kayda ilk kez bağlandığında, orada düzenlenmiş venturiler ortak listeye eklenir; hiç dokunulmamış varsayılan venturi eklenmez.
- Üst çubuktaki **☁ Ortak** düğmesi durumu gösterir: eşit / bekliyor / kaydediliyor / salt okunur / çakışma.
- Tema, açık sekme, açık venturi ve InfluxDB parolası her bilgisayarda yerel kalır, ortak dosyaya yazılmaz.

**Kurulum (bir kez):**
1. GitHub'da veri deposu açın: `venturiValidation-data` (public: herkes okuyabilir; private: sadece parolası olanlar okur).
2. Fine-grained token oluşturun: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
   - Repository access: *Only select repositories* → yalnızca `venturiValidation-data`
   - Permissions → Contents: **Read and write** (başka izin vermeyin)
3. Uygulamada `tools/anahtar.html` sayfasını açın (GitHub Pages'te: `https://<kullanıcı>.github.io/venturiValidation/tools/anahtar.html`).
   Token'ı ve ortak parolayı girin → **Test Et ve Şifrele**. Token ve parola bu tarayıcıdan çıkmaz.
4. Üretilen içerikle uygulama deposundaki `js/sync-config.js` dosyasını değiştirip commit edin. Dosyada token'ın kendisi değil, şifreli hâli bulunur.
5. Uygulamayı açın; ilk açılışta ortak parola sorulur.

**Güvenlik notu:** Şifreli anahtar herkese açık kodda durur. Kısa bir parola deneme yoluyla bulunabilir, bu durumda biri veri dosyasını değiştirebilir (eski hâli commit geçmişinden geri alınabilir). Anahtar yalnızca veri deposuna yetkili olduğundan uygulama kodu etkilenmez. Parola sızarsa: GitHub'da token'ı iptal edin, yenisini oluşturup 3–4. adımları tekrarlayın.

---

## InfluxDB v1 Kurulumu ve Bağlantı

### 1. Kurulum

En hızlı yol Docker'dır:

```bash
docker run -d --name influxdb -p 8086:8086 -v influxdb:/var/lib/influxdb influxdb:1.8
```

Paket kurulumu (Linux/Windows) için InfluxData'nın resmi v1 dokümantasyonundaki adımları izleyin: <https://docs.influxdata.com/influxdb/v1/introduction/install/>

### 2. Veritabanı ve kullanıcı

```bash
influx -execute "CREATE DATABASE db"
# (Opsiyonel) Kimlik doğrulama:
influx -execute "CREATE USER admin WITH PASSWORD 'güçlü-parola' WITH ALL PRIVILEGES"
influx -execute "CREATE USER scada WITH PASSWORD 'okuma-parolasi'"
influx -execute "GRANT READ ON db TO scada"
```

Kimlik doğrulamayı açmak için `/etc/influxdb/influxdb.conf` dosyasında `[http]` bölümüne `auth-enabled = true` yazın.

### 3. Veri şeması

Varsayılan yapı: measurement `telemetry`, **her sensör bir field**:

```text
telemetry P1=2.31,P2=1.52,T1=24.8,Q1=71250   # P1/P2 bar g, T °C, Q kg/h
```

Sensör adı tag olarak tutuluyorsa ("Sensör adı nerede? → Tag değeri"):

```text
telemetry,name=P1 value=2.31
```

Test verisi yazma:

```bash
curl -i -XPOST 'http://10.10.2.6:8086/write?db=lc_100' --data-binary 'telemetry P1=2.31,P2=1.52,T1=24.8,Q1=71250'
```

### 4. Uygulamanın gönderdiği sorgu

```sql
SELECT last("P1") FROM "telemetry" WHERE time > now() - 300s;
SELECT last("P2") FROM "telemetry" WHERE time > now() - 300s
```

İstek: `GET {URL}/query?db=lc_100&q=...&epoch=ms[&u=..&p=..]`

### 5. Uygulama ayarları (Canlı sekmesi)

| Alan | Örnek |
|---|---|
| URL | `http://10.10.2.6:8086` |
| Veritabanı | `lc_100` |
| Measurement | `telemetry` |
| Sensör adı nerede? | Field adı |
| ΔP kaynağı | ΔP sensörü (ör. `DP1`) veya P1 − P2 (`P1`, `P2`) |
| Debi (Coriolis), sıcaklık, yoğunluk | ör. `Q1` (kg/h), `T1` (°C), `RHO1` (kg/m³) |
| Yenileme / sorgu penceresi | 250 ms … / 5 dk |

Ayarları girdikten sonra:

1. **Bağlantı Testi** ile her sensörün son değerini kontrol edin.
2. **▶ Başlat** ile canlı izlemeyi başlatın.

### CORS

InfluxDB 1.x HTTP API'si tarayıcı isteklerine `Access-Control-Allow-Origin` başlığıyla yanıt verir. InfluxDB bir ters vekilin (Nginx vb.) arkasındaysa vekilde bu başlığı ekleyin:

```nginx
location / {
  proxy_pass http://127.0.0.1:8086;
  add_header Access-Control-Allow-Origin * always;
  add_header Access-Control-Expose-Headers X-Influxdb-Version always;
}
```

---

## HTTPS / Mixed Content Sorunu

GitHub Pages HTTPS ile sunulur. Tarayıcılar HTTPS bir sayfadan `http://10.10.2.6:8086` gibi HTTP adreslere yapılan istekleri **engeller**. Uygulama bu durumu algılayıp **"Tarayıcı Güvensiz İçerik İzni Rehberi"** popup'ını açar. Çözüm seçenekleri:

| Yöntem | Adımlar |
|---|---|
| **Chrome / Edge** | Adres çubuğu 🔒 → *Site ayarları* → **Güvenli olmayan içerik: İzin ver** → sayfayı yenileyin. Özel ağ erişim istemi çıkarsa onaylayın. |
| **Firefox** | Kilit simgesi → *Korumayı şimdilik devre dışı bırak*. Kalıcı çözüm: `about:config` → `security.mixed_content.block_active_content = false` (yalnızca güvenilir iç ağ istasyonlarında). |
| **Önerilen kalıcı çözüm** | InfluxDB'de TLS'i açın (`https-enabled = true`) veya önüne TLS sonlandıran bir ters vekil koyun, URL'yi `https://` yapın. |
| **Yerel çalıştırma** | `python -m http.server 8080` ile `http://localhost:8080` üzerinden açın. Bu durumda mixed content oluşmaz. |

---

## CSV Formatları

Örnek dosyalar `samples/` klasöründedir. Sütun sırası ve adları serbesttir; eşleştirme ekranında seçilir.

**Akışkan özellik tablosu** (`samples/su_ozellikleri.csv`, `;` ayırıcı, ondalık virgül):

```csv
Sıcaklık (°C);Yoğunluk (kg/m3);Viskozite (mPa.s);Buhar Basıncı (kPa)
5;999,97;1,519;0,872
25;997,05;0,890;3,169
```

**Ölçüm / kalibrasyon verisi** (`samples/olcum_verisi.csv`, `,` ayırıcı; sıcaklık ve yoğunluk sütunları opsiyoneldir):

```csv
timestamp,flow_m3h,dp_mbar,temp_C
2026-10-01T10:00:00Z,19.98,15.50,20.1
```

- Zorunlu alanlar: T, ρ, μ (özellik tablosu) veya Debi, ΔP (ölçüm verisi).
- Sayısal olmayan veya eksik satırlar atlanır ve atlanan satır sayısı bildirilir.

---

## Dosya Yapısı

```text
index.html          Arayüz iskeleti
css/app.css         SCADA/HMI teması (Dark/Light), yerleşim, PDF rapor stili
lib/                Üçüncü taraf kütüphaneler (Chart.js, MathJax, html2pdf.js, marked) — internetsiz çalışma
js/units.js         MODÜL 2 — Birim tanımları ve dönüşümler (SI çekirdek)
js/physics.js       MODÜL 1 — ISO 5167-4 / ASME / Bernoulli, ε, kayıp, belirsizlik, düz boru
js/fluids.js        MODÜL 3/4 — Akışkan kütüphanesi, interpolasyon, ideal gaz, boru kütüphanesi
js/csv.js           MODÜL 3 — Akıllı CSV ayrıştırma ve sütun eşleştirme arayüzü
js/influx.js        MODÜL 5 — InfluxDB v1 (InfluxQL) istemcisi: son değer, zaman aralığı, mixed content
js/draw.js          MODÜL 4 — Ölçekli SVG Venturi kesiti ve basınç profili
js/chart.js         MODÜL 4/5 — Performans eğrisi, sınır çizgileri, canlı kırmızı nokta
js/report.js        MODÜL 6 — html2pdf A4 raporu
js/calib.js         Kalibrasyon motoru — 6 model (sıvı/gaz), LOO çapraz doğrulama, ρ(T)/μ(T), TwinCAT/IEC ST kodu
js/ui.js            Pencere, bildirim, dosya indirme yardımcıları
js/store.js         Durum yönetimi — venturi kayıtları, eski sürüm geçişi, localStorage, ortak kayıt verisi
js/live.js          Canlı telemetri — sensörler, a·x+b, sensör başına ortalama, ΔP sıfırlama
js/fluidui.js       Akışkan sekmesi ve sıcaklığa bağlı özellik grafiği
js/calibui.js       Kalibrasyon & PLC ekranı (test tablosu, model kıyası, grafikler, kod çıktısı)
js/history.js       Geçmiş veriden kalibrasyon (kararlı bölüm bulma)
js/venturis.js      Çoklu venturi yönetimi penceresi
js/trend.js         Zaman trendi
js/help.js          Uygulama içi kullanım kılavuzu (README görüntüleyici)
js/readme-data.js   README'nin gömülü kopyası (node tools/build-readme.js ile üretilir)
js/app.js           Hesap döngüsü, göstergeler, çizim, formüller, PDF, başlatma
js/sync.js          Ortak kayıt — GitHub Contents API, venturi bazında birleştirme, PBKDF2 + AES-GCM
js/sync-config.js   Ortak kayıt deposu ve şifreli anahtar
tools/anahtar.html  Token'ı ortak parolayla şifreleyen yardımcı sayfa
tools/build-readme.js  README → js/readme-data.js
tests/              Birim + uçtan uca testler (tests/run-all.sh)
samples/            Örnek CSV dosyaları
.nojekyll           GitHub Pages için Jekyll'i devre dışı bırakır
```

---

## Testler

```bash
tests/run-all.sh
```

- `tests/build-check.js`: sözdizimi, README gömülü kopyasının güncelliği, sürüm tutarlılığı, CDN kullanılmadığı.
- `tests/unit-calib.js`: sıvı ve gaz kalibrasyonu; üretilen PLC kodunun uygulamayla aynı sonucu verdiği.
- `tests/e2e.js` (Playwright/Chromium): eski kayıt geçişi, canlı demo, trend, ΔP sıfırlama, çoklu venturi, yardım, kalibrasyon (sıvı/gaz), PDF, JSON yedek, mobil görünüm, geçmiş veriden kalibrasyon (sahte InfluxDB), ortak kayıt birleştirme (sahte GitHub), dış ağ isteği olmadığı.

---

## Varsayımlar ve Sınırlamalar

- **C değerleri:** Sabit C değerleri ISO 5167-4:2003'teki geçerlilik aralıkları içinde geçerlidir. Aralık dışı durumlar uygunluk panelinde ✗ ile işaretlenir.
- **ASME MFC-3M:** Klasik Venturi için aynı imalat tiplerini ve katsayıları kullanır. Farklı bir sürüm veya üretici kalibrasyonu varsa **Basit Bernoulli** modunda kalibre edilmiş C_d girin.
- **Kalıcı basınç kaybı:** Gibson korelasyonuna dayalı bir mühendislik tahminidir. Kesin değer için üretici verisi veya test kullanılmalıdır.
- **Düz boru tablosu:** ISO 5167-4 Tablo 1 esas alınmıştır ama değerler standarttan doğrulanmamıştır. Kritik projelerde standardın güncel baskısıyla doğrulayın.
- **Gaz debisi gösterimi:** m³/h, LPM ve GPM gibi hacimsel gaz debileri **işletme koşullarında** (gerçek hacim) gösterilir, normal/standart koşullara çevrilmez.
- **Gizlilik:** Uygulama tamamen istemci tarafında çalışır. Veriler yalnızca tarayıcınızda (`localStorage`) ve yapılandırdığınız InfluxDB sunucusuyla paylaşılır.
