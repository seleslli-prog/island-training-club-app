export const INDEMNITY_VERSION = "v1";

export const DOCUMENTS = {
  indemnity: {
    title: "Indemnity",
    renderBody: renderIndemnityDocument,
  },
  privacy: {
    title: "Privacy Policy",
    provisional: false,
    renderBody: renderPrivacyDocument,
  },
  guidelines: {
    title: "Community Guidelines",
    provisional: false,
    renderBody: renderGuidelinesDocument,
  },
};

export function renderIndemnityDocument() {
  return `
    <div class="doc-content">
      <h3>ITC Hyrox Training - Liability Release &amp; Data Privacy Form</h3>
      <p>I am aware that my participation in the Island Training Club (“<strong>ITC</strong>”) Hyrox Training from the date of signing to 30 June 2027, including but not limited to: HYROX-style training, running, rowing, SkiErg, sled push/pull, wall balls, lunges, burpees, bodyweight movements, weights, warm-ups, cool-downs, partner drills and/or other functional fitness exercises (the “<strong>Activity</strong>”) involve inherent risks, including fatigue, overexertion, muscle soreness, sprains, strains, falls, collision with persons or objects, aggravation of pre-existing conditions, illness, injury and, in rare cases, serious injury or death.</p>
      <p>Having regard to the religious and non-profit nature of ITC and Island Evangelical Community Church Limited (“<strong>IECC</strong>”) (including but not limited to their officers, directors, employees, agents, representatives and volunteers) (collectively, the “<strong>Organizer</strong>”) of the Activity, and in consideration of IECC and/or ITC accepting my participation in the Activity, I hereby agree and confirm as follows:</p>
      <ol class="doc-clauses">
        <li data-clause="1">to assume and accept all and any risks of personal injury, sickness, death, damage, dangers and expenses arising out of, incidental to or in any way connected with my participation to the Activity;</li>
        <li data-clause="2">to waive any and all claims, actions, costs, expenses and demands that I may have against the Organizer within and outside Hong Kong;</li>
        <li data-clause="3">to release:
          <ol class="doc-subclauses" type="a">
            <li>the Organizer from any and all liability for any loss, damage, injury or expense that I or my next of kin may suffer or incur as a result of my participation in the Activity, due to any cause whatsoever including but not limited to negligence on the part of the Organizer; and</li>
            <li>IECC from any and all liability for any loss, damage or expense that arises in relation to the storage, maintenance and/or usage of any equipment in respect of the Activity or any other Hyrox-related training taking place within the premise of IECC;</li>
          </ol>
        </li>
        <li data-clause="4">to hold harmless and indemnify:
          <ol class="doc-subclauses" type="a">
            <li>the Organizer for any liability sustained by the Organizer as the result of my negligent, willful or intentional acts; and</li>
            <li>IECC for any loss or damage caused to any part of the premise, fixture or equipment of IECC resulting from my participation in the Activity;</li>
          </ol>
        </li>
        <li data-clause="5">that appropriate insurance shall be taken out by me on an individual level (if necessary), and the Organizer shall not be responsible for taking out personal liability insurance for the Activity or for individuals participating in the Activity. It is my sole discretion and responsibility to subscribe my own personal insurance liability relating to the Activity if I deem necessary;</li>
        <li data-clause="6">the leaders of ITC and/or IECC have the right to request an individual to cease participation in the Activity if, at the sole opinion of the leaders of ITC and/or IECC, the actions of that individual may endanger the safety of himself/herself and/or other participants of the Activity;</li>
        <li data-clause="7">that my level of physical fitness is adequate for the Activity and, if not, that I will be responsible for ensuring that I consult with a physician about my physical condition before and after participating in the Activity;</li>
        <li data-clause="8">that this Form shall be effective and binding upon my next of kin, executors, administrators and assigns, in the event of my death;</li>
        <li data-clause="9">that I agree to the personal data privacy statement of IECC (available at <a href="https://www.islandecc.hk/privacy-policy/" target="_blank" rel="noopener noreferrer">https://www.islandecc.hk/privacy-policy/</a>) and I agree that the personal data provided by me for the Activity will be used for the purposes of managing and organizing the Activity and handling my enquiries in relation to the Activity and/or the Organizer (and for this purpose, the data shall be owned by IECC and ITC); and</li>
        <li data-clause="10">that the laws of Hong Kong shall govern this Form and any disputes arising hereof shall be determined by the courts of Hong Kong.</li>
      </ol>
    </div>`;
}

export function renderPrivacyDocument() {
  return `
    <div class="doc-content">
      <h3>What we collect</h3>
      <p>When you apply to join Island Training Club (ITC), we collect your name, email, mobile or WhatsApp number, emergency contact details, and your photo/video consent preference. We keep your bookings and payment receipts while you are a member.</p>
      <h3>Why we collect it</h3>
      <p>We use this information to review your application, contact you about sessions and schedule changes, reach your emergency contact if something happens, and manage your bookings and receipts.</p>
      <h3>Who sees it</h3>
      <p>Only ITC leaders and the systems that run the club. We never sell your information or share it with third parties for marketing.</p>
      <h3>Your choices</h3>
      <p>Photo and video consent is required to take part in ITC sessions. You can review that consent, along with the privacy policy, community guidelines and indemnity you accepted, from Profile → Agreements. You can ask an ITC leader to correct or delete your information. Questions? Contact ITC Committee or speak to any ITC leader before or after a session.</p>
    </div>`;
}

export function renderGuidelinesDocument() {
  return `
    <div class="doc-content">
      <h3>Everyone is welcome</h3>
      <p>ITC is open to every fitness level and every background. There are no tryouts and no prerequisites — approval never depends on fitness level.</p>
      <h3>Respect and encouragement</h3>
      <p>We train together as a community. Encourage the person next to you, welcome newcomers, and treat every member, leader and volunteer with respect. Harassment, discrimination and bullying have no place at ITC.</p>
      <h3>Safety first</h3>
      <p>Follow the instructions of ITC leaders at all times. Work within your own limits, scale movements when asked, and tell a leader about any injury or health concern before a session starts.</p>
      <h3>Photos and media</h3>
      <p>We sometimes take photos and videos at sessions. You will only appear if you have given consent. Questions or concerns? Contact ITC Committee.</p>
      <h3>Conduct</h3>
      <p>Members who repeatedly ignore these guidelines may be asked to leave a session, or have their membership reviewed by ITC leaders.</p>
    </div>`;
}
