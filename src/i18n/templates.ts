import { TEMPLATES } from '../core';
import type { Language } from './index';

const tr: Record<string, { name: string; description: string }> = {
  and: { name: 'İlk AND kapın', description: 'İki giriş, bir çıkış ve içini açabileceğin iki NAND kapılı uygulama.' },
  'nand-xor': { name: 'Dört NAND ile XOR', description: 'Tüm bağlantıları açıkta olan, dört kapıdan oluşan eksiksiz XOR devresi.' },
  'half-adder': { name: 'Yarım toplayıcı', description: 'İki biti topla; toplam ve elde çıkışlarını birbirinden bağımsız incele.' },
  'full-adder': { name: 'Tam toplayıcı', description: 'Dokuz NAND kapılı toplayıcıda iki operandın yanına giriş eldesi de katılır.' },
  adder8: { name: '8 bit dalgalı elde toplayıcı', description: '3 + 4 ile başla, ardından eldeyi ve 8 bitlik taşmayı keşfet.' },
  subtractor8: { name: '8 bit çıkarıcı', description: 'İkiye tümleyenle çıkarmayı ve açıkça gösterilen ödünç çıkışını incele.' },
  mux8: { name: '8 bit çoklayıcı', description: 'Tek bitlik seçim sinyali iki bağımsız 8 bitlik veri yolundan birini seçer.' },
  register8: { name: 'Saatli yazmaç', description: 'Giriş anında değişir; saklanan çıkış yalnızca etkin bir yükselen kenarda güncellenir.' },
  counter8: { name: '8 bit sayaç', description: 'Gerçek toplayıcı ve yazmaç her saatte değeri artırır; sıfırlama etkinleştirmeden önceliklidir.' },
  memory: { name: 'RAM okuma ve yazma', description: '16 sözcüklük bellekte asenkron okumayı ve saat kenarında yazmayı dene.' },
  decoder: { name: '2’den 4’e kod çözücü', description: 'İki bitlik veri yolunu, aynı anda yalnızca biri etkin dört tek bitlik çıkışa dönüştür.' },
  comparator: { name: '4 bit karşılaştırıcı', description: 'İşaretsiz sayıları karşılaştır; eşitlik, küçüklük ve büyüklük sinyallerini gözle.' },
  bus: { name: 'Veri yolunu ayır ve birleştir', description: 'En düşük anlamlı bitin sırasını incele ve 8 bitlik sözcüğü yeniden oluştur.' },
};

export function templateText(id: string, language: Language): { name: string; description: string } {
  const template = TEMPLATES.find(item => item.id === id);
  return language === 'tr' && tr[id] ? tr[id] : { name: template?.name ?? id, description: template?.description ?? '' };
}
