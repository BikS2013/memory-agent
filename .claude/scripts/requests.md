I want you to enhance the design and implementation to support: 
- different options for the database used. At least I need support for sqllite(current option), sql server, and Azure blob storage 
- particularly for the blob storage option, I suggest to investigate the option of using the user name as the file name (propably combined with a time period indicator) used to store and retrieve the user "memories"
- to support the multiple storage options, I want you to consider the option of creating a dedicated yaml configuration file (storage-config.yaml) where the various options available will be registered. 
- I want you also to support different LLM options. 
- I want you to use the langchain library to integrate the various LLM options. 
- I want you to introduce the llm-config.yaml file as a uniform way to describe the configuration parameters for the LLMs used by the agent. 
