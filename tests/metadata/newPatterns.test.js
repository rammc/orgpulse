import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyze as analyzeFlow,
  resetRegistry as resetFlowRegistry,
  finalizePass as finalizeFlow,
} from '../../src/metadata/analyzers/flowAnalyzer.js';
import {
  analyze as analyzeMeta,
  finalizePass as finalizeMeta,
  resetRegistry as resetMetaRegistry,
} from '../../src/metadata/analyzers/metadataAnalyzer.js';

beforeEach(() => {
  resetFlowRegistry();
  resetMetaRegistry();
});

describe('flowAnalyzer performance patterns', () => {
  it('flags subflow invoked inside a loop', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <label>SubInLoop</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <start>
    <object>Account</object>
    <triggerType>RecordAfterSave</triggerType>
    <recordTriggerType>Update</recordTriggerType>
    <filters>
      <field>Name</field>
      <operator>NotEqualTo</operator>
      <value><stringValue>x</stringValue></value>
    </filters>
  </start>
  <loops>
    <name>loop_Items</name>
    <collectionReference>col_Items</collectionReference>
    <iterationOrder>Asc</iterationOrder>
    <nextValueConnector><targetReference>sub_DoWork</targetReference></nextValueConnector>
  </loops>
  <subflows>
    <name>sub_DoWork</name>
    <flowName>Shared_Sub</flowName>
    <connector><targetReference>loop_Items</targetReference></connector>
  </subflows>
</Flow>`;
    const findings = analyzeFlow('/flows/SubInLoop.flow-meta.xml', xml);
    expect(findings.some((f) => f.pattern === 'FLOW_SUBFLOW_IN_LOOP')).toBe(true);
  });

  it('flags redundant Get Records on $Record.Id', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <label>Redundant</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <start>
    <object>Account</object>
    <triggerType>RecordAfterSave</triggerType>
    <recordTriggerType>Update</recordTriggerType>
    <filters><field>Name</field><operator>NotEqualTo</operator><value><stringValue>x</stringValue></value></filters>
  </start>
  <recordLookups>
    <name>lookup_Self</name>
    <object>Account</object>
    <filters>
      <field>Id</field>
      <operator>EqualTo</operator>
      <value><elementReference>$Record.Id</elementReference></value>
    </filters>
    <getFirstRecordOnly>true</getFirstRecordOnly>
  </recordLookups>
</Flow>`;
    const findings = analyzeFlow('/flows/Redundant.flow-meta.xml', xml);
    expect(findings.some((f) => f.pattern === 'FLOW_REDUNDANT_TRIGGER_QUERY')).toBe(true);
  });

  it('flags Get Records without any filter', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <label>NoFilter</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <start>
    <object>Account</object>
    <triggerType>RecordAfterSave</triggerType>
    <recordTriggerType>Update</recordTriggerType>
    <filters><field>Name</field><operator>NotEqualTo</operator><value><stringValue>x</stringValue></value></filters>
  </start>
  <recordLookups>
    <name>lookup_AllContacts</name>
    <object>Contact</object>
  </recordLookups>
</Flow>`;
    const findings = analyzeFlow('/flows/NoFilter.flow-meta.xml', xml);
    expect(findings.some((f) => f.pattern === 'FLOW_GET_RECORDS_NO_FILTER')).toBe(true);
  });

  it('flags storeOutputAutomatically=true', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <label>StoreAuto</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <start>
    <object>Account</object>
    <triggerType>RecordAfterSave</triggerType>
    <recordTriggerType>Update</recordTriggerType>
    <filters><field>Name</field><operator>NotEqualTo</operator><value><stringValue>x</stringValue></value></filters>
  </start>
  <recordLookups>
    <name>lookup_Auto</name>
    <object>Contact</object>
    <filters><field>AccountId</field><operator>EqualTo</operator><value><elementReference>$Record.Id</elementReference></value></filters>
    <storeOutputAutomatically>true</storeOutputAutomatically>
  </recordLookups>
</Flow>`;
    const findings = analyzeFlow('/flows/StoreAuto.flow-meta.xml', xml);
    expect(findings.some((f) => f.pattern === 'FLOW_STORE_OUTPUT_AUTOMATICALLY')).toBe(true);
  });
});

describe('metadataAnalyzer performance patterns', () => {
  it('flags roll-up summary on high-contention parent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Open_Case_Count__c</fullName>
  <label>Open Case Count</label>
  <type>Summary</type>
  <summaryOperation>count</summaryOperation>
  <summarizedField>Case.Id</summarizedField>
  <summaryForeignKey>Case.AccountId</summaryForeignKey>
</CustomField>`;
    const findings = analyzeMeta(
      '/force-app/main/default/objects/Account/fields/Open_Case_Count__c.field-meta.xml',
      xml
    );
    expect(findings.some((f) => f.pattern === 'ROLLUP_SUMMARY_HOT_PARENT')).toBe(true);
  });

  it('does not flag roll-up on non-contentious parent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Total__c</fullName>
  <type>Summary</type>
  <summaryOperation>sum</summaryOperation>
</CustomField>`;
    const findings = analyzeMeta(
      '/force-app/main/default/objects/Custom_Parent__c/fields/Total__c.field-meta.xml',
      xml
    );
    expect(findings.length).toBe(0);
  });

  it('flags active workflow rule + field update on hot object', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">
  <rules>
    <fullName>Touch_Account</fullName>
    <active>true</active>
    <criteriaItems>
      <field>Account.Name</field>
      <operation>notEqual</operation>
      <value>x</value>
    </criteriaItems>
  </rules>
  <fieldUpdates>
    <fullName>Stamp_Updated</fullName>
    <field>Description</field>
    <literalValue>touched</literalValue>
    <reevaluateOnChange>true</reevaluateOnChange>
  </fieldUpdates>
</Workflow>`;
    const findings = analyzeMeta(
      '/force-app/main/default/workflows/Account.workflow-meta.xml',
      xml
    );
    expect(findings.some((f) => f.pattern === 'ACTIVE_WORKFLOW_RULE')).toBe(true);
    expect(findings.some((f) => f.pattern === 'WORKFLOW_FIELD_UPDATE_HOT_OBJECT')).toBe(true);
  });

  it('finalize pass flags multiple active triggers on same sObject', () => {
    analyzeMeta(
      '/force-app/main/default/triggers/AccTrigger1.trigger',
      'trigger AccTrigger1 on Account (before insert) { System.debug(1); }'
    );
    analyzeMeta(
      '/force-app/main/default/triggers/AccTrigger1.trigger-meta.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion><status>Active</status>
</ApexTrigger>`
    );
    analyzeMeta(
      '/force-app/main/default/triggers/AccTrigger2.trigger',
      'trigger AccTrigger2 on Account (after update) { System.debug(2); }'
    );
    analyzeMeta(
      '/force-app/main/default/triggers/AccTrigger2.trigger-meta.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion><status>Active</status>
</ApexTrigger>`
    );
    const findings = finalizeMeta();
    const multi = findings.find((f) => f.pattern === 'MULTIPLE_ACTIVE_TRIGGERS_SAME_OBJECT');
    expect(multi).toBeDefined();
    expect(multi.triggerObject).toBe('Account');
    expect(multi.triggerCount).toBe(2);
    expect(multi.severity).toBe('critical');
  });

  it('does not flag when only one trigger is active', () => {
    analyzeMeta(
      '/force-app/main/default/triggers/SoleTrigger.trigger',
      'trigger SoleTrigger on Account (before insert) {}'
    );
    analyzeMeta(
      '/force-app/main/default/triggers/SoleTrigger.trigger-meta.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion><status>Active</status>
</ApexTrigger>`
    );
    const findings = finalizeMeta();
    expect(findings.length).toBe(0);
  });

  it('ignores inactive trigger in duplicate detection', () => {
    analyzeMeta(
      '/force-app/main/default/triggers/A1.trigger',
      'trigger A1 on Account (before insert) {}'
    );
    analyzeMeta(
      '/force-app/main/default/triggers/A1.trigger-meta.xml',
      `<?xml version="1.0"?><ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata"><status>Active</status></ApexTrigger>`
    );
    analyzeMeta(
      '/force-app/main/default/triggers/A2.trigger',
      'trigger A2 on Account (before insert) {}'
    );
    analyzeMeta(
      '/force-app/main/default/triggers/A2.trigger-meta.xml',
      `<?xml version="1.0"?><ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata"><status>Inactive</status></ApexTrigger>`
    );
    const findings = finalizeMeta();
    expect(findings.length).toBe(0);
  });
});

describe('cross-referenced field registry patterns', () => {
  const nonIndexedField = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Region__c</fullName>
  <type>Text</type>
  <length>80</length>
</CustomField>`;

  const indexedExternalId = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Customer_Ref__c</fullName>
  <type>Text</type>
  <length>40</length>
  <externalId>true</externalId>
</CustomField>`;

  const longTextAreaField = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Notes__c</fullName>
  <type>LongTextArea</type>
  <length>131072</length>
  <visibleLines>10</visibleLines>
</CustomField>`;

  function flowWithFilter(object, field) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <label>FilterTest</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <start>
    <object>Account</object>
    <triggerType>RecordAfterSave</triggerType>
    <recordTriggerType>Update</recordTriggerType>
    <filters><field>Name</field><operator>NotEqualTo</operator><value><stringValue>x</stringValue></value></filters>
  </start>
  <recordLookups>
    <name>lookup_Filtered</name>
    <object>${object}</object>
    <filters>
      <field>${field}</field>
      <operator>EqualTo</operator>
      <value><stringValue>EU</stringValue></value>
    </filters>
  </recordLookups>
</Flow>`;
  }

  function flowWithStoreAuto(object) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <label>StoreAutoTest</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <start>
    <object>Account</object>
    <triggerType>RecordAfterSave</triggerType>
    <recordTriggerType>Update</recordTriggerType>
    <filters><field>Name</field><operator>NotEqualTo</operator><value><stringValue>x</stringValue></value></filters>
  </start>
  <recordLookups>
    <name>lookup_Auto</name>
    <object>${object}</object>
    <filters><field>AccountId</field><operator>EqualTo</operator><value><elementReference>$Record.Id</elementReference></value></filters>
    <storeOutputAutomatically>true</storeOutputAutomatically>
  </recordLookups>
</Flow>`;
  }

  it('flags non-indexed custom field used in Flow filter', () => {
    analyzeMeta(
      '/force-app/main/default/objects/Account/fields/Region__c.field-meta.xml',
      nonIndexedField
    );
    analyzeFlow('/flows/FilterTest.flow-meta.xml', flowWithFilter('Account', 'Region__c'));
    const findings = finalizeFlow();
    expect(findings.some((f) => f.pattern === 'FLOW_UNINDEXED_FILTER')).toBe(true);
  });

  it('does NOT flag when custom field is external ID', () => {
    analyzeMeta(
      '/force-app/main/default/objects/Account/fields/Customer_Ref__c.field-meta.xml',
      indexedExternalId
    );
    analyzeFlow(
      '/flows/FilterTest.flow-meta.xml',
      flowWithFilter('Account', 'Customer_Ref__c')
    );
    const findings = finalizeFlow();
    expect(findings.some((f) => f.pattern === 'FLOW_UNINDEXED_FILTER')).toBe(false);
  });

  it('does NOT flag standard fields even if not in registry', () => {
    analyzeFlow('/flows/FilterTest.flow-meta.xml', flowWithFilter('Account', 'Industry'));
    const findings = finalizeFlow();
    expect(findings.some((f) => f.pattern === 'FLOW_UNINDEXED_FILTER')).toBe(false);
  });

  it('flags heap risk when storeOutputAutomatically + LongTextArea on target', () => {
    analyzeMeta(
      '/force-app/main/default/objects/Contact/fields/Notes__c.field-meta.xml',
      longTextAreaField
    );
    analyzeFlow('/flows/StoreAutoTest.flow-meta.xml', flowWithStoreAuto('Contact'));
    const findings = finalizeFlow();
    const heap = findings.find((f) => f.pattern === 'FLOW_STORE_OUTPUT_HEAP_RISK');
    expect(heap).toBeDefined();
    expect(heap.heapField).toBe('Notes__c');
    expect(heap.heapFieldType).toBe('LongTextArea');
  });

  it('does NOT flag heap risk without LongTextArea on target', () => {
    analyzeMeta(
      '/force-app/main/default/objects/Contact/fields/Region__c.field-meta.xml',
      nonIndexedField.replace('Region__c', 'Region__c')
    );
    analyzeFlow('/flows/StoreAutoTest.flow-meta.xml', flowWithStoreAuto('Contact'));
    const findings = finalizeFlow();
    expect(findings.some((f) => f.pattern === 'FLOW_STORE_OUTPUT_HEAP_RISK')).toBe(false);
  });
});
