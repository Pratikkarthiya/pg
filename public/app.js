const room = document.getElementById('room');
document.querySelectorAll('.room-select').forEach(button => button.addEventListener('click', () => {
  room.value = button.dataset.room;
  document.getElementById('enquiry').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  document.getElementById('name').focus({ preventScroll: true });
}));
const date = document.getElementById('date');
const now = new Date();
date.min = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
document.getElementById('enquiry-form').addEventListener('submit', event => {
  event.preventDefault();
  if (date.value < date.min) { date.setCustomValidity('Please choose today or a future date.'); date.reportValidity(); return; }
  const name = document.getElementById('name').value.trim();
  if (!name) { document.getElementById('name').setCustomValidity('Please enter your name.'); document.getElementById('name').reportValidity(); return; }
  const text = `BLISS GIRLS PG — GANDHINAGAR\nVisit enquiry\n\nName: ${name}\nRoom preference: ${room.value}\nPreferred visit date: ${date.value}\nQuestions: ${document.getElementById('message').value.trim() || 'Please share pricing, availability, address and included facilities.'}\n\nThis is a prepared enquiry, not a confirmed booking. Share it with the PG team once contact details are available.\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'bliss-pg-enquiry.txt'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.getElementById('form-status').textContent = 'Your enquiry is ready to download. It has not been sent. Share the file with the PG team when contact details are available.';
});
date.addEventListener('input', () => date.setCustomValidity(''));
document.getElementById('name').addEventListener('input', event => event.target.setCustomValidity(''));

async function loadRoomDetails() {
  try {
    const response = window.blissDemo ? {ok:true,json:()=>window.blissDemo.request('/api/rooms',undefined,'GET')} : await fetch('/api/rooms', { cache: 'no-store' });
    if (!response.ok) throw new Error('Room updates unavailable');
    const { rooms } = await response.json();
    const cards = document.querySelectorAll('.room-card');
    rooms.forEach((item, index) => {
      const card = cards[index]; if (!card) return;
      if (item.rent !== null) {
        const price = card.querySelector('.room-footer > span');
        price.classList.add('room-price');
        price.textContent = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(item.rent);
        const suffix = document.createElement('small'); suffix.textContent = ' / person / month'; price.append(suffix);
      }
      if (!item.photos.length) return;
      const imageBox = card.querySelector('.room-image');
      imageBox.classList.add('has-photos'); imageBox.querySelector('small').hidden = true;
      const image = imageBox.querySelector('img');
      let current = 0;
      const controls = document.createElement('div'); controls.className = 'gallery-controls';
      const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '←'; previous.setAttribute('aria-label', `Previous ${item.name} photo`);
      const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
      const next = document.createElement('button'); next.type = 'button'; next.textContent = '→'; next.setAttribute('aria-label', `Next ${item.name} photo`);
      function showPhoto() { const photo = item.photos[current]; image.src = photo.url; image.alt = photo.caption; count.textContent = `${current + 1} / ${item.photos.length}`; }
      previous.addEventListener('click', () => { current = (current - 1 + item.photos.length) % item.photos.length; showPhoto(); });
      next.addEventListener('click', () => { current = (current + 1) % item.photos.length; showPhoto(); });
      previous.disabled = next.disabled = item.photos.length < 2;
      controls.append(previous, count, next); imageBox.append(controls); showPhoto();
    });
    const firstPhoto = rooms.flatMap(item => item.photos)[0];
    if (firstPhoto) {
      const hero = document.querySelector('.hero-photo'); const image = hero.querySelector('img'); image.src = firstPhoto.url; image.alt = firstPhoto.caption; image.style.filter = 'none';
      hero.querySelector('.photo-label').textContent = 'A glimpse of your next chapter';
      hero.querySelector('.image-caption').textContent = 'BLISS GIRLS PG · ROOM PHOTOS';
    }
  } catch {
    const message = document.createElement('p'); message.className = 'live-room-error'; message.setAttribute('role', 'status');
    message.textContent = 'Live rent and photo updates are temporarily unavailable. Please refresh or enquire for current details.';
    document.querySelector('#rooms').append(message);
  }
}
loadRoomDetails();
